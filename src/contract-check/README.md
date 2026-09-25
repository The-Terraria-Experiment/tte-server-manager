# contract-check

Checks a live game server's REST responses against the wire contracts in
[`docs/contracts/`](../../docs/contracts/README.md). The server can be TShock with its plugins, or
tModLoader with TteControl and TteInventoryMonitor.

Like `sprite-tools/`, nothing builds or deploys this. It is a hand-run tool (`.mjs`, so the root
typecheck ignores it).

## When to run it

After anything that could change what a server sends back:
- upgrading TShock or tModLoader
- rebuilding a plugin or mod
- bumping a contract version

A drift at this boundary doesn't fail loudly. The calls still succeed, and a field just stops
meaning what the backend thinks it means. This is the check for exactly that.

## Running

```bash
cd src/contract-check
npm install
npm run check -- --instance i-0547061b934ecd3cd              # stage proxy
npm run check -- --instance i-049f4ecb27799beba --alias prod
npm run check -- --instance <id> --player SomeName           # read a specific online player
```

The instance must be running **with a world launched**, because the REST API only exists while the
game server does. With nobody online, `/inventory/read` is skipped unless you pass `--player`. The
snapshot check still validates a full report whenever the server has retained a capture.

Exit codes:
- `0`: every check passed
- `1`: at least one check failed
- `2`: the check couldn't run (no world, missing config, AWS error)

## What it checks

It reads only; nothing here stops the server, kicks, bans, removes or clears anything.

| Endpoint | Checked against |
|---|---|
| `/v2/server/status` | `control-rest.md`: field types, the `"200"` status string, `uptime` format, tML extension fields, and `contractVersions` against each doc's major version |
| `/tte/mods` (tML) | `control-rest.md`: mod entries, and that TteControl is enabled and loaded |
| `/inventory/itemnames` | `inventory-monitor.md`: the vanilla map looks complete; the tML `modItems` keys are well-formed |
| `/inventory/snapshots?since=0&limit=1` | `inventory-monitor.md`: cursor fields, plus the report inside, if any. Non-destructive: there is no ack, and the scanner's cursor lives in Dynamo |
| `/inventory/read` | `inventory-monitor.md`: the full report shape (`globalSlot` range, `itemKey` on tML, `account: null`/`group: ""` on tML), and the `400` for an unknown player |

The expected contract versions are read from the `contractVersion` line at the top of each doc,
so there is no copy here to fall out of date.

## How it reaches the server

It invokes the `tshock-proxy` lambda directly, at the alias you pick, with the same request the
backend sends. It reads the proxy's ARN, the REST port, the credential's secret name and the
instance table from `ttesm-server-manager`'s configuration at that alias.

It deliberately doesn't use SSM with `curl` on the box. That would put the REST password into SSM
command history. An invoke payload is never persisted.

Permissions the caller needs:
- `lambda:GetFunctionConfiguration` on `ttesm-server-manager`
- `lambda:InvokeFunction` on `ttesm-tshock-proxy`
- `secretsmanager:GetSecretValue` on the REST credential
- `dynamodb:GetItem` on the instance table
- `ec2:DescribeInstances`
