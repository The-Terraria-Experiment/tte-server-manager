# Instance setup

Takes a bare Ubuntu EC2 instance to a fully provisioned TTE Terraria server:
AWS CLI, dotnet, the file layout the lambdas expect, TShock, the metrics
collector, the SSM agent, and the REST account the lambdas authenticate with.

Like `metrics/`, this is **not built or deployed by any pipeline**. It's staged
on the box by hand and run once.

## Why SSH and not SSM Run Command

The script installs the SSM agent, so it can't depend on it. It runs over SSH on
a fresh box; once it finishes, everything afterwards (including re-running this
script) can go through Run Command.

## Before you run it

Two things must be in place first, and neither can be done from inside the
instance — the script pulls TShock from S3, so it needs the role *already*
attached or it can't do anything at all.

### 1. Instance role

Needs `AmazonSSMManagedInstanceCore` plus an inline policy covering the
buckets/table. Bucket and table names below are the real, fleet-wide values
(same defaults baked into `setup.sh`); `<filestore-bucket>` is the one
exception — that's `S3_FILESTORE_NAME`, a separate bucket the script doesn't
touch, so it's left as a placeholder:

```jsonc
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::ttesm-resources/*" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::ttesm-server-configs/*" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<filestore-bucket>/*" },
    { "Effect": "Allow", "Action": ["s3:PutObject"],
      "Resource": ["arn:aws:s3:::ttesm-logs/metrics/*",
                   "arn:aws:s3:::ttesm-logs/tshock-console/*"] },
    { "Effect": "Allow", "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::<filestore-bucket>", "arn:aws:s3:::ttesm-server-configs",
                   "arn:aws:s3:::ttesm-logs"] },
    { "Effect": "Allow", "Action": ["dynamodb:GetItem", "dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/ttesm-instance-data" }
  ]
}
```

`s3:ListBucket` on the **logs** bucket is required by the metrics uploader: it
uses `aws s3 sync`, which lists the destination prefix to decide what changed.
The old per-file `aws s3 cp` never listed anything, so a policy predating that
change will have `PutObject` but not `ListBucket` and the upload will fail with
`AccessDenied` on the list — with the objects themselves perfectly writable.

That last statement is for the `register` step (below) and is scoped to a single
table, matching the blast radius of everything else here. Deliberately **not**
included: anything under `lambda:*`. `EC2_INSTANCE_IDS` stays a manual step for
that reason — see "After it finishes."

```bash
aws ec2 associate-iam-instance-profile \
  --instance-id <instance-id> \
  --iam-instance-profile Name=<instance-profile-name>
```

### 2. Security group

```bash
aws ec2 modify-instance-attribute \
  --instance-id <instance-id> \
  --groups <sg-id>
```

The group needs inbound `7777` (Terraria) from anywhere, `22` from your IP for
the duration of setup, and `3891` (TShock REST).

> **Read this before opening 3891.** The lambdas connect to
> `http://<publicIp>:3891` — the **public** IP, over **plain HTTP**, with the
> REST token in the query string. That means the port has to be reachable from
> the internet, and the credentials cross it unencrypted. This is the existing
> design, not something this script introduces, but provisioning a new box is
> the moment to decide whether you want to keep it. The tighter options are
> putting the lambdas in the VPC and switching to private IPs, or fronting REST
> with TLS. If you're leaving it as-is, at minimum don't reuse the REST password
> anywhere else.

## The TShock artifact

Not set up yet on your side. The script expects a single zip at
`s3://<bucket>/<key>` (default key `tshock/current.zip`) that unpacks to:

```
TShock.Server          <- the executable
*.dll, *.json, ...     <- the rest of the release
ServerPlugins/         <- default plugins
```

A wrapping top-level directory is fine — the script normalises both shapes. To
your question of whether that's everything: it's everything the *installer*
needs. Two things are generated on first run rather than shipped in the zip, and
the script handles both — `config.json` and `tshock.sqlite`. Don't put those in
the artifact; if the zip carries a `tshock.sqlite`, it'll overwrite the REST
account on every upgrade.

Versioning is just the key. Keep `tshock/current.zip` as the pointer and upload
real versions alongside it (`tshock/5.2.0.zip`) so a rollback is a copy.

## Run it

### The lazy way

```bash
./setup/remote-setup.sh
```

Runs on **your own machine**, not the instance. Prompts for the instance IP
plus SSH user/key and the REST password (each with a default shown in
brackets — hit enter to accept it), then does the `scp` + `ssh` + `sudo
setup.sh` for you and drops you into a shell on the box once it's done.

SSH user/key and the REST password are remembered in
`~/.tte-setup-remote.env` (mode 600) so a repeat run against a *different* new
instance only really costs you typing the IP. The instance IP itself is
deliberately never remembered — silently defaulting it would risk re-running
setup against the wrong live box. Bucket/port/account settings stay hidden
behind a single "customize advanced settings? (y/N)" prompt, since those
already default correctly (below) and asking about all twelve every time
would defeat the point.

### The manual way

What `remote-setup.sh` does under the hood, if you'd rather drive it yourself
(or SSH agent/key setup makes the wrapper awkward for your setup):

```bash
scp -r src/instance-scripts/ ubuntu@<ip>:/tmp/tte/
ssh ubuntu@<ip>

sudo TTE_REST_PASSWORD='<matches Secrets Manager>' /tmp/tte/setup/setup.sh
```

The bucket/port/table variables below default to the real fleet-wide values
(confirmed against the live account, not guessed), so in practice the only
thing you need to pass is `TTE_REST_PASSWORD`. Override the rest only if this
instance is genuinely different (e.g. pointing at a test bucket).

Copy the whole `instance-scripts/` directory, not just `setup/` — the metrics
step invokes `../metrics/install.sh`.

If the instance's `inst#<id>` row already carries a `metricsConfig` (i.e. you're
rebuilding a box whose collector was configured from the web UI), the `metrics`
step reads it back and applies it, so a fleet replacement doesn't silently reset
everyone's settings to defaults. A genuinely new instance has no row yet — this
step runs before `register` seeds one — and gets the installer's defaults.

`TTE_REST_PASSWORD` **must** match `TSHOCK_PASSWORD` in the Secrets Manager
secret named by `TSHOCK_SECRET_NAME`. The script has no way to check this; if
they disagree, every REST call fails at token creation and the server reads as
permanently offline in the UI.

| Variable | Default | |
| --- | --- | --- |
| `TTE_ROOT` | `/home/ubuntu/terraria` | must equal the lambdas' `TSHOCK_WD` |
| `TTE_USER` | `ubuntu` | |
| `TTE_TSHOCK_BUCKET` | `ttesm-resources` | |
| `TTE_TSHOCK_KEY` | `tshock/current.zip` | |
| `TTE_LOGS_BUCKET` | `ttesm-logs` | |
| `TTE_CONFIG_BUCKET` | `ttesm-server-configs` | |
| `TTE_INSTANCE_TABLE` | `ttesm-instance-data` | skipped with a warning if set empty (see "Registering the instance") |
| `TTE_VALID_ROOTS` | `main=/tshock,worlds=/worlds,plugins=/tshock/ServerPlugins` | nickname=path pairs, comma-separated; matches the shape used across the existing fleet |
| `TTE_WORLD_PATH_NICKNAMES` | `worlds` | comma-separated, must be a subset of the nicknames in `TTE_VALID_ROOTS` |
| `TTE_REST_PORT` | `3891` | must equal `TSHOCK_API_PORT` |
| `TTE_REST_USER` | `ttesm_lambda_user` | must equal `TSHOCK_USER` in the secret |
| `TTE_REST_PASSWORD` | — | required |
| `TTE_DOTNET_MAJOR` | `9` | |

Idempotent — re-run to upgrade. Individual steps:

```bash
sudo ... setup.sh --only tshock      # just pull a new TShock build
sudo ... setup.sh --skip account     # everything but the account bootstrap
```

## Account bootstrap — the part most likely to need a second look

This is the step I'd expect to fail first, and the reason is worth knowing.

TShock has no offline "add user" command. Accounts are created either in-game or
from the server console, and the app's normal launch path deliberately runs
TShock with `< /dev/null` (see `launchWorld.ts`) so it has no console at all.

So the script boots TShock once against a throwaway world in `/tmp`, with a
fifo wired to stdin, and writes console commands into it:

```
/group add ttesm-rest
/group addperm ttesm-rest <each permission>
/user add ttesm_lambda_user <password> ttesm-rest
/off
```

The console session is implicitly superadmin, so no `/setup` code is involved.
Afterwards it verifies **against `tshock.sqlite`, not the console output** —
TShock reports several of these as successful even when they partially applied.
On failure it dumps the full transcript. A successful run also saves it to
`$ROOT/logs/setup-console.log`.

The permission list lives in `REST_PERMS` at the top of `setup.sh` and mirrors
the docstring on `_shared/shared/utils/TShockAPI.ts`. **If you add a REST call
there that needs a new permission, add it in both places** — existing instances
won't pick it up, and the symptom is a 403 on one specific feature.

If the console commands don't take (TShock version differences in command syntax
are the likely cause), the fallback is seeding SQLite directly — the users table
stores a BCrypt hash, so inspect the live schema before writing to it:

```bash
sqlite3 /home/ubuntu/terraria/tshock/tshock.sqlite ".schema Users" ".schema GroupList"
```

I'd try fixing the console syntax first; hand-writing BCrypt hashes into a
schema TShock owns is the more fragile of the two.

## Registering the instance

Two things make a provisioned box actually usable in the app. They get very
different treatment here, on purpose.

**The DynamoDB row is automated** (the `register` step). It writes
`inst#<id>` with `validRoots`/`worldPaths` from `TTE_VALID_ROOTS` /
`TTE_WORLD_PATH_NICKNAMES` — checked against the live table's existing entries
rather than guessed, so the default matches what the rest of the fleet already
uses. It's guarded: if the row already has `validRoots` (e.g. you later
customized paths through the Users page's path editor), the step leaves it
alone rather than overwriting your changes on a re-run.

**`EC2_INSTANCE_IDS` is deliberately *not* automated.** It's tempting to treat
this the same way as the Dynamo row, but it isn't the same kind of change:

- It's a Lambda environment variable, not a database row.
  `update-function-configuration` **replaces the entire variable map** rather
  than merging — passing just `EC2_INSTANCE_IDS` would silently wipe every
  other hand-set var on that function, including things (Cognito pool/client
  IDs, secret names) that live nowhere else in this repo.
- Updating `$LATEST` doesn't make it live. Per the deploy workflow, a new
  version only gets published — and an alias only repointed — on a push to
  `stage`/`main`. Making the change effective immediately means also running
  `publish-version` and `update-alias` yourself, i.e. performing a deploy
  outside the normal CI path.
- Doing it from the box would mean granting the instance role
  `lambda:UpdateFunctionConfiguration` (and probably `PublishVersion`/
  `UpdateAlias`). That's a much bigger blast radius than the scoped S3/Dynamo
  access above — the difference between a compromised box being able to
  corrupt its own file prefix versus being able to rewrite live Lambda config
  or repoint the prod alias. Given this same box already has a REST port open
  to the internet by design, that's not a permission worth adding for
  convenience.

So this stays a manual step, run from your own machine with your own
credentials — never from the instance. `setup.sh` prints the exact commands at
the end, including a reminder to fetch the current `Environment.Variables` map
in full before editing it (see the printed `env.json` step) rather than
setting `EC2_INSTANCE_IDS` in isolation.

Finally: **confirm the Secrets Manager password matches** what you passed as
`TTE_REST_PASSWORD` — the script can't check this itself, and a mismatch
surfaces as every REST call failing at token creation.

## Then snapshot an AMI

Once one instance is verified working, image it. New instances become "launch
from AMI, attach role and SG" with no script run at all, and this script stays
the reproducible record of what's in that image.

Exclude the instance-specific bits before imaging, or fix them on first boot —
`/etc/tte-instance.env` records the instance ID it was built for, the S3 config
seed is keyed `inst#<id>`, and the `register` step's Dynamo row is keyed the
same way. Re-running `--only config,register` on the new instance corrects all
three (`register`'s guard only skips if the *new* instance's row already has
`validRoots` — a fresh instance ID means a fresh row, so it won't no-op here).

## Verify

```bash
tte-metrics-ctl status
systemctl list-timers 'tte-metrics-*'
sqlite3 /home/ubuntu/terraria/tshock/tshock.sqlite "SELECT Username, Usergroup FROM Users;"
jq '.Settings | {RestApiEnabled, RestApiPort, EnableTokenEndpointAuthentication}' \
  /home/ubuntu/terraria/tshock/config.json
aws ssm describe-instance-information --query "InstanceInformationList[?InstanceId=='<id>']"
```

End to end, with a world running:

```bash
curl "http://localhost:3891/v2/token/create?username=ttesm_lambda_user&password=<pass>"
```

A token in the response means the lambdas will authenticate. That's the single
most useful check — it exercises the account, the group, the config patch, and
the port together.
