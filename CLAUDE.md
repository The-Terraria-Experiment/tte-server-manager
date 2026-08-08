# AI Coding Agent Instructions — tte-server-manager

These instructions guide AI assistants working on this repository. Keep changes minimal, focused, and consistent with the existing Vue + Vite stack. Prefer incremental PRs.

> **This file is a living document.** When you discover that something here is stale, wrong, or missing — a renamed lambda, a new env var, a changed workflow — update the relevant section as part of your change instead of leaving it to drift. Don't guess at facts you haven't verified against the actual code; check before writing them down.

---

## Overview
- **Goal:** Server management interface for Terraria/TShock/TModLoader running on EC2.
- **Stack:** Vue 3 SPA (Vite, Pinia, Vue Router, Tailwind) hosted via AWS Amplify Hosting; API Gateway → Lambda; Cognito (via Amplify Gen 2 backend) federated with a custom Patreon OIDC shim for auth; DynamoDB for permissions/instance/system data; Secrets Manager; CloudWatch; EC2 with SSM; S3 for config/world/log files; TShock REST API.
- **Scalability:** Design for multiple `Instance` and `GameServer` entities (no hardcoding single IDs).

## Repository Layout
The repo root is **not** the Vite app root — there are two separate `package.json`/`node_modules` trees:
- **Repo root** (`package.json`, `tsconfig.json`): only wires up the TypeScript typecheck (`npm run compile`) across all lambda/shared TS+JS files. No dev/build scripts live here.
- **`src/tte-server-manager/`**: the actual Vite/Vue frontend app root (its own `package.json`, `vite.config.js`, `amplify/`). Vue source lives under `src/tte-server-manager/src/` (components, stores, router, util, etc.) — not directly under the repo's top-level `src/`.
- **`src/lambda/`**: backend Lambda functions, one directory per function (see Architecture below), plus `src/lambda/_shared/` for shared middleware/AWS clients/utils used by all of them.
- **`src/shared/types/`**: TS types shared between frontend and backend (`APIGatewayTypes.ts`, `LambdaTypes.ts`).
- **`src/instance-scripts/`**: shell/systemd assets that run *on the EC2 instances*, not in Lambda. Not built or deployed by any pipeline in this repo — staged onto a box and installed by hand (or via SSM Run Command). Contains `metrics/` (the CPU/mem collector, see below — including `tte-metrics-ctl.sh`, the control surface the web UI drives over SSM) and `setup/` (full instance provisioning: AWS CLI, dotnet, file layout, TShock from S3, metrics, SSM agent, and the TShock REST account). `setup/setup.sh` runs over SSH rather than SSM because it installs the SSM agent itself; it invokes `../metrics/install.sh`, so the whole `instance-scripts/` directory has to be staged together.

## Environments

The application runs in three environments with distinct deployment strategies and shared infrastructure:

### Production (Prod)
- **URL:** `server.theterrariaexperiment.com`
- **Git Branch:** `main`
- **Frontend:** Amplify Hosting (auto-deploy on push to main)
- **Backend:** API Gateway → Lambda functions (prod alias)
- **Auth:** Cognito User Pool (prod), federated with the Patreon OIDC shim at its own prod base path

### Staging (Stage)
- **URL:** `stg-server.theterrariaexperiment.com`
- **Git Branch:** `stage`
- **Frontend:** Amplify Hosting (auto-deploy on push to stage)
- **Backend:** API Gateway → Lambda functions (stage alias)
- **Auth:** Cognito User Pool (stage), federated with the Patreon OIDC shim at its own stage base path

### Development (Dev)
- **URL:** `localhost:5173` (Vite dev server)
- **Git Branch:** `dev/*` (feature branches; all dev branches start with `dev/`)
- **Frontend:** Local Vite dev server (`npm run dev`, run from `src/tte-server-manager/`)
- **Backend:** Uses stage backend (same API Gateway & Lambda stage aliases as staging)
- **Auth:** Uses stage Cognito User Pool / stage Patreon shim

### Shared Resources & Separation

**Lambda Functions:**
- Prod and stage share the same Lambda function code deployed to the same functions
- Separation via **Lambda aliases**: `prod` alias vs `stage` alias
- Each alias can have distinct environment variables (set by hand on `$LATEST` and baked in at publish — not tracked in IaC or this repo) and concurrency settings

**DynamoDB Tables:**
- **Shared across prod/stage:** tables related to EC2 instances (instance metadata, status)
  - Justification: EC2 instances are shared infrastructure accessed by both environments
- **Separate per environment:** permission entries, user/link data, system notices, and other environment-scoped tables
  - `cognito-user-link` in particular resolves its tables from the Cognito user pool it's invoked against, not from `ACTIVE_ENV` — see project memory `project_cognito_trigger_alias`
- Exact table names are passed in via Lambda env vars (e.g. `PERM_TABLE_PROD`/`PERM_TABLE_STAGE`, `INSTANCE_TABLE_NAME`) rather than hardcoded in code — check the relevant lambda's env vars before assuming a schema or naming convention.

**EC2 Instances:**
- All environments can access all EC2 instances
- Single fleet of instances shared across prod, stage, and dev
- Instance management commands (start/stop/restart) are available in all environments

**S3 Buckets:**
- Common buckets between environments (config, world/log storage)

**Secrets Manager:**
- Common secrets between environments

### Development Workflow
1. **Local development:** Work on `dev/*` branches; run frontend locally; calls stage backend.
2. **Staging:** Merge to `stage` branch; Amplify auto-deploys to `stg-server.theterrariaexperiment.com`.
3. **Production:** Merge `stage` → `main`; Amplify auto-deploys to `server.theterrariaexperiment.com`.

### Environment Variable Patterns
- Lambda env vars include `ACTIVE_ENV` (prod/stage) to determine which DynamoDB tables to access; some functions instead take explicit `*_PROD`/`*_STAGE` pairs (e.g. Cognito pool/client IDs, Patreon shim base URL, issuer URL, app origin).
- Frontend auth config comes from `src/tte-server-manager/amplify_outputs.json` (generated by the Amplify Gen 2 backend under `src/tte-server-manager/amplify/`), not from hand-set `VITE_COGNITO_*` env vars.
- Frontend `.env` files only need to carry `VITE_API_BASE_URL` (API Gateway base URL) and `VITE_ENVIRONMENT`.

---

## Architecture
- **Web Interface:** Vue SPA built with Vite; deployed on AWS Amplify Hosting (build/deploy pipeline managed by Amplify).
- **API Layer:** API Gateway with REST endpoints; JWT (Cognito ID token) forwarded by frontend as `Authorization: Bearer`; `api-authorizer` Lambda validates it against both prod and stage Cognito pools.
- **Lambda Functions** (`src/lambda/*`, one dir per function):
  - `api-authorizer`: API Gateway Lambda authorizer; verifies the Cognito ID token.
  - `instance-manager`: EC2 instance list/start/stop/restart, file browsing/upload/download/sync via SSM+S3, and the metrics collector control plane (read/write its config, force an upload) driven over SSM through `tte-metrics-ctl` on the box. Also hosts the **asynchronous shutdown worker** (`shutdownWorker`, self-invoked; see the shutdown gotchas below) — which is why its timeout is 300s rather than 30s.
  - `server-manager`: TShock server control — status, run command, manage bans/players, config read/write, world create/launch.
  - `user-manager`: user permissions (read/write), username, Patreon account linking, user deletion.
  - `system-manager`: roles, system notices, Patreon tier map, auto-shutoff pause/cancel.
  - `auto-shutoff-manager`: idle-EC2 detection/shutdown (`AUTO_SHUTOFF_*` env vars). Invoked directly by EventBridge Scheduler: a recurring per-env tick, plus one-time schedules it creates for itself to drive the staged countdown (warn at 10/5/2 min → stop server → stop EC2). See the auto-shutoff gotcha below before changing how steps are scheduled.
  - `logs-manager`: TShock console log listing/search/transcript retrieval from S3.
  - `cognito-user-link`: Cognito trigger(s) linking Patreon-federated identities to app users; resolves its tables from the invoking user pool.
  - `tshock-proxy`: VPC-attached transport for TShock REST calls. Invoked synchronously by `server-manager`, `auto-shutoff-manager` and `instance-manager` (the shutdown job's graceful server stop); makes the HTTP request from inside the VPC so the instances' REST port can stay closed to the internet. Makes **no AWS API calls at all** — see the gotcha below before adding one.
  - `patreon-oidc`: standalone OIDC shim exposing Patreon's OAuth2 API as a Cognito-compatible external IdP (`/authorize`, `/callback`, `/token`, `/jwks`, `/userinfo`, `/.well-known/openid-configuration`, mounted under `/auth/patreon/*`). Called by Cognito and Patreon directly, not by the frontend, so it bypasses the shared action/permission middleware.
  - `_shared`: middleware, AWS client wrappers (`DynamoDB`, `S3`, `EC2`, `SSM`, `Cognito`, `CloudWatch`, `SecretsManager`, `Lambda`, `Scheduler`), and `utils/` (grouped by domain — `utils/core/` generic cross-cutting helpers like `APIResponse`, `Assert`, `Perms`, `Parsers`, `Redact`, `Network`, `HmacToken`, `Delay`, `LogDateRanges`; `utils/jobs/` the async-job framework and its consumers, `AsyncJob`, `ShutdownJob`, `ShutdownTasks`, `WorldgenJob`, `SyncBudget`, `Cleanup`; `utils/tshock/` everything that talks to or configures TShock, `TShockAPI`, `TShockDirect`, `TShockProxy`, `TShockConfig`, `TShockLaunch`, `TShockConsoleLogs`, `TShockServerStop`; `utils/instance/` EC2-instance-level state, `InstanceRegistry`, `InstanceFileSync`, `InstanceMetrics`) used by all of the above.
- **Auth:** Cognito User Pool (Amplify Gen 2 backend, config in `src/tte-server-manager/amplify/`), federated with the in-house `patreon-oidc` Lambda so Patreon is the identity source; permission checks are per-user, resolved from a permissions table keyed by `user#<sub>` and enforced both client-side (`hasPermissions` in `userStore`, gating UI + `apiRequest` calls) and server-side (each lambda's action handlers).
- **Data:** DynamoDB — permission/user-link data, instance metadata/status, system notices, Patreon tier map, roles. Table names/keys are supplied via env vars per function rather than fixed constants; verify the current schema in `_shared/shared/utils/core/Perms.ts` and the relevant `_shared/shared/aws/DynamoDB.ts` callers before assuming structure.
- **Files:** S3 buckets for the instance filestore (`S3_FILESTORE_NAME`), TShock config (`S3_CONFIG_BUCKET_NAME`), and console logs + instance metrics (`S3_LOGS_BUCKET_NAME`, under the `tshock-console/` and `metrics/` prefixes respectively); synced to/from EC2 via SSM; world/instance files served through `instance-manager`. The filestore is the source of truth for which instance files are *tracked*: whatever exists under `{instanceId}/` is what gets browsed, downloaded, and re-synced on shutdown — so anything that lands there stays tracked until explicitly deleted.
- **Secrets/IAM:** TShock REST token in Secrets Manager (`TSHOCK_SECRET_NAME`); Patreon OAuth creds, OIDC signing key, relay-state and link-intent secrets also in Secrets Manager; Lambda roles least-privilege (S3, Dynamo, EC2, SSM, Secrets).
- **Observability:** CloudWatch logs via the shared `CWLogger`; structured logs from Lambdas. Instance-level CPU/memory is *not* on CloudWatch custom metrics — a homebrew collector (`src/instance-scripts/metrics/`) samples `/proc` on a systemd timer and pushes JSONL to the logs bucket under `metrics/{instanceId}/YYYY/MM/DD/HH.jsonl`. The local buffer mirrors that same key layout so a local path becomes its S3 key by stripping the buffer root; uploads are SigV4-signed `curl` PUTs rather than the AWS CLI. The free built-in EC2 metrics (CPU, network, disk I/O, status checks) are still in CloudWatch and still free; only the paid custom series were replaced. The collector can be turned off and retuned from the Instance page — see the metrics gotchas below.

## Frontend Conventions
- **App root:** `src/tte-server-manager/` (own `package.json`; run all frontend commands from here, not the repo root).
- **Framework:** Vue 3 + Vite (JavaScript). Avoid TypeScript unless requested.
- **Routing:** `src/tte-server-manager/src/router/index.js` defines pages; routes use `meta.requiresAuth` when protected.
- **State:** Pinia stores in `src/tte-server-manager/src/stores/` (`userStore`, `rolesStore`, `serverStore`, `statusStore`, `alertStore`, `patreonTierMapStore`, `baseStore`); expose getters/actions; do not mutate state outside actions.
- **Components:**
  - Pages: `src/tte-server-manager/src/components/pages/` (Home, Overview, Instance, Server, Users, Login, Terms, plus `tools/` subpages)
  - Shared/Common UI: `src/tte-server-manager/src/components/shared/`, `src/tte-server-manager/src/components/common/`
- **Repeating tasks:** `statusStore.subscribeToTask`/`subscribeToTaskEnd` always take a stable `handlerID`, and the subscriber unsubscribes in `beforeUnmount`. A handler bound to a component instance is a new function on every mount, so without both the dedupe can't recognise it as a repeat — a route revisit registers another copy and the task fires the same handler (and the same alert) once per past visit, against components that no longer exist.
- **Alerts:** `$alert.error` is sticky (no auto-dismiss) because errors carry the detail the user has to act on; other types expire after 5s. Identical un-dismissed messages are collapsed rather than stacked. Pass an explicit `duration` to override.
- **Styling:** Tailwind utility classes; keep class lists concise; theme in `src/tte-server-manager/src/theme.css` and `src/tte-server-manager/src/style.css`.
- **API Calls:** Use `src/tte-server-manager/src/util/api.js` (`get`/`post`/`put`/`deleteRequest`) — it attaches the Cognito ID token, checks the caller's permission(s) client-side before sending, and retries once on 401 after a token refresh.

## Backend Integration Points (Contract)
- **Headers:** `Authorization: Bearer <cognitoIdToken>`; `Content-Type: application/json` (omitted for `FormData` uploads).
- **Endpoints (representative — grep `src/tte-server-manager/src` for `get(`/`post(` for the current full set):**
  - `GET /instances` → list instances and status, scoped to this environment's registry
  - `GET /instances/registry` → all registry entries across every environment (with live EC2 state; unresolvable IDs come back `missing`) | `POST /instances/registry` → register an ID after validating it against EC2 | `PUT /instances/registry/{id}` → change which environments it serves | `POST /instances/registry/{id}/delete` → deregister (refused while the instance is running)
  - `GET /instance/{id}/status` | `GET /instance/{id}/files` — the status response's `instance` object carries a `shutdown` block (job status/step/progress/`active`) when the instance has been stopped through the job path; `GET /server/{id}/status` carries the same block on its own `instance` field
  - `POST /instance/{id}/stop` → queues a shutdown job and returns `{ jobID, status: "queued" }` immediately; 409 `SHUTDOWN_IN_PROGRESS` if one is already running
  - `GET /instance/{id}/metrics/config` (`?verify=true` to also read live state off the box) | `PUT /instance/{id}/metrics/config` | `POST /instance/{id}/metrics/upload` (`?selftest=true` to PUT a probe object instead of the buffer, verifying SigV4 signing + S3 IAM)
  - `GET /server/{id}/status` | `GET /server/{id}/config`
  - `POST /server/{id}/command` → run a TShock command
  - File browse/upload/download/sync routes under `instance-manager`
  - Permission/role/user-management routes under `user-manager` / `system-manager`
- **Errors:** JSON `{ code, message, details? }`; 4xx for validation/permission (e.g. `SSM_NOT_READY` surfaced via `error.code`), 5xx for server errors.

## Environment & Configuration
- **Frontend `.env` keys (Vite, in `src/tte-server-manager/.env.local` etc.):**
  - `VITE_API_BASE_URL` (API Gateway base URL)
  - `VITE_ENVIRONMENT`
  - Cognito/auth config comes from `amplify_outputs.json`, not Vite env vars.
- **Lambda env vars (vary by function — check the function's own code before assuming one applies elsewhere):**
  - `ACTIVE_ENV`, `AWS_REGION`
  - `COGNITO_USER_POOL_ID_PROD`/`_STAGE`, `COGNITO_CLIENT_ID_PROD`/`_STAGE`
  - `PATREON_SHIM_BASE_URL_PROD`/`_STAGE`, `ISSUER_URL_PROD`/`_STAGE`, `APP_ORIGIN_PROD`/`_STAGE`, `ALLOWED_COGNITO_REDIRECT_URIS`
  - `PERM_TABLE_PROD`/`_STAGE`, `INSTANCE_TABLE_NAME`, `SYS_MSG_KEY`
  - `S3_FILESTORE_NAME`, `S3_CONFIG_BUCKET_NAME`, `S3_LOGS_BUCKET_NAME`, `BASE_ROOT`
  - `SSM_FILE_TREE_DOCUMENT`, `SSM_FILE_TREE_IGNORE_DIRS`
  - `INSTANCE_CACHE_VERSION_POLL_MS` (instance-manager, auto-shutoff-manager; how often the cached instance registry re-checks its version row — default 60000). `EC2_INSTANCE_IDS` and `AUTO_SHUTOFF_SERVER_IDS*` are **gone** — the instance list lives in DynamoDB now, see the registry gotcha below.
  - `TSHOCK_SECRET_NAME`, `TSHOCK_API_PORT`, `TSHOCK_PATH`, `TSHOCK_WD`, `TSHOCK_OUT_LOGS`, `TSHOCK_ERR_LOGS`
  - `TSHOCK_PROXY_FUNCTION_ARN` (server-manager, auto-shutoff-manager, instance-manager — the last for the shutdown job's graceful server stop, which also needs `TSHOCK_API_PORT` + `TSHOCK_SECRET_NAME` and `lambda:InvokeFunction`/`secretsmanager:GetSecretValue` on its role; **unqualified** base ARN of `tshock-proxy` — `vars.ts` appends `:prod`/`:stage` from `ACTIVE_ENV`. Same shape as `INSTANCE_MANAGER_FUNCTION_ARN`, which is likewise a single base var, not a `_PROD`/`_STAGE` pair). `tshock-proxy` itself takes **no env vars** — its port and credential arrive in the invoke payload.
  - `WORLD_CREATE_POLL_DELAY_MS`, `WORLD_CREATE_STABLE_COUNT`, `WORLD_CREATE_UPLOAD_RESERVE_MS` (wall-clock the worldgen worker keeps for the S3 upload after the world file is ready), `WORLD_CREATE_STALE_MS` (how long a worldgen job may go without a heartbeat before it's treated as abandoned). `WORLD_CREATE_POLL_ATTEMPTS` is **obsolete** — the wait is bounded by the lambda's own remaining time now, so the function timeout is the knob (`ttesm-server-manager` is at 900s, minus the ~90s upload reserve ≈ 13.5min of worldgen); the var is still set but no longer read.
  - `AUTO_SHUTOFF_IDLE_MINUTES`, `AUTO_SHUTOFF_EC2_DELAY_MINUTES`, `INSTANCE_TABLE_NAME` (auto-shutoff reads the instance registry to decide which servers it watches — its role needs `dynamodb:GetItem`/`Scan` on that table), `AUTO_SHUTOFF_SCHEDULER_ROLE_ARN` (role EventBridge Scheduler assumes to invoke this lambda), `INSTANCE_MANAGER_FUNCTION_ARN` (**unqualified** base ARN of `instance-manager`, which auto-shutoff invokes to run the shutdown job; `vars.ts` appends `:prod`/`:stage` — its role also needs `lambda:InvokeFunction` on that function)
  - `SHUTDOWN_STALE_MS` (instance-manager; how long a shutdown job may go without a heartbeat before it's treated as abandoned — default 180000, and must stay above the largest task `maxMs`)
  - `PATREON_CREDS_SECRET_NAME`, `SIGNING_KEY_SECRET_NAME`, `LINK_INTENT_SECRET_NAME`, `RELAY_STATE_SECRET_NAME`, `SHIM_TOKEN_CREDS_SECRET_NAME`
  - `ALLOWED_ORIGIN` (CORS)
  - These are set by hand and are not defined anywhere in this repo or an IaC template — see project memory `project_lambda_env_out_of_band`.
- **Secrets:** TShock API token and Patreon-related secrets all in Secrets Manager, referenced by the `*_SECRET_NAME` env vars above.

## Security & Permissions
- **Least privilege:** IAM roles only grant exact actions (Dynamo, S3, EC2:Start/Stop, SSM:SendCommand, Secrets:GetSecretValue).
- **Validation:** Every authenticated action is gated both client-side (`hasPermissions` before the request is sent) and server-side (each lambda's own action handler checks the caller's permissions from the perm table).
- **Audit:** Structured JSON logs to CloudWatch via `CWLogger` for admin/tool actions.
- **CORS:** Restrict origins via `ALLOWED_ORIGIN`; allow `Authorization` header.

## Developer Workflows
- **Frontend install & run** (from `src/tte-server-manager/`):
  ```bash
  npm install
  npm run dev
  ```
- **Frontend build & preview** (from `src/tte-server-manager/`):
  ```bash
  npm run build
  npm run preview
  ```
- **TypeScript typecheck (Lambda code, incl. `src/lambda/_shared`):** run from the **repo root** (not inside `src/lambda/*` or `src/tte-server-manager`) — only the root `tsconfig.json`/`package.json` are wired for this:
  ```bash
  npm run compile
  ```
  This runs `tsc --noEmit` against the root `tsconfig.json`, which includes every `.ts`/`.js` file in the repo. There is no ESLint config anywhere in this repo — this typecheck is the verification/"linting" step for backend/shared TS changes.
- **Frontend patterns:**
  - Add new page: create component in `src/tte-server-manager/src/components/pages/`, register route in `src/tte-server-manager/src/router/index.js`, protect with `meta.requiresAuth` if needed.
  - Use Pinia stores for shared state; avoid global singletons outside stores.
- **Testing:** There is currently no test runner configured anywhere in this repo (no vitest, no other framework, no test script). Don't assume test infra exists — if a task needs tests, that setup has to be added first.
- **CI/CD:** `.github/workflows/deploy-lambdas.yml` builds every lambda via `src/lambda/build.js` and deploys on push to `stage`/`main`: `update-function-code` → set `ACTIVE_ENV` on `$LATEST` → `publish-version` → point the `stage`/`prod` alias at the new version. Because it publishes from `$LATEST`, whatever env vars are sitting on `$LATEST` get baked into that version — that's how hand-set vars reach an alias (see project memory `project_lambda_env_out_of_band`). Provisioning itself (function/role/queue/schedule creation, IAM) is still out-of-band — no CDK/Terraform is checked in here.

## Multi-Instance Design Guidance
- Model `Instance` and `GameServer` with IDs; all APIs accept `instanceId` and `serverId`.
- No hardcoded single-instance logic; UI lists and selects active instance/server.
- Keep S3 paths namespaced per instance/server for configs/worlds.

## Coding Style & PR Guidance
- Keep changes focused; avoid refactors outside scope.
- Name components with PascalCase; stores as `<name>Store.js`.
- Document public functions with JSDoc when logic is non-trivial.
- Small PRs; describe user-facing impact and any new env vars.

## Gotchas
- TShock REST: enforce timeouts/retries; token from Secrets.
- SSM file sync: validate paths, prefer S3 pre-signed download to instance.
- Cognito tokens: prefer ID token for user identity; refresh gracefully.
- Route53/Global Accelerator health checks against the EC2 fleet on port 7777 show up as repeated `15.177.x.x` "connecting..." noise in TShock logs — this is our own health-checking, not an attack; don't block it, move the GA health-check port if it needs to stop.
- Cognito Lambda trigger aliases only work when set via the CLI/API — the Console UI has no alias selector. Never run `update-user-pool` to fix this: it's a full-replace call and will wipe the custom email template.
- `patreon-oidc` intentionally skips the shared action/permission middleware other lambdas use, because it's called by Cognito and Patreon directly rather than the authenticated frontend — don't "fix" it to match the other lambdas' pattern.
- Auto-shutoff countdown steps are timers, not work items — schedule them with `SchedulerDao.UpsertOneTimeSchedule` (one-time EventBridge schedule, `MaximumRetryAttempts: 0`, `ActionAfterCompletion: DELETE`), never a queue. This previously used SQS `DelaySeconds`, and SQS's redeliver-until-acked semantics turned one timed-out invocation into a 90-minute retry loop: every 30s (the visibility timeout) it redelivered, each retry dispatched a fresh full-upload SSM command, ~250 of those piled up, and they re-uploaded files faster than they could be deleted. Schedule names are deterministic per env+server+step precisely so a re-decided step *replaces* its pending timer instead of stacking another. Stale timers are harmless by design — `runCheck` re-reads state and no-ops on `canceled`/`paused`/not-idle.
- The instance metrics collector flushes on shutdown through its own `tte-metrics-flush.service` (`ExecStop`, `TimeoutStopSec=20`), deliberately *not* through the lambda-side shutdown sync. Don't move it there: that path is on a tight deadline budget it would eat into, and anything landing in the filestore stays *tracked* forever. Under `uploadMode: manual` this unit stops being a nicety and becomes the only thing between a stop and losing everything buffered since the last trigger, so `tte-metrics-ctl` enables it whenever collection is on, regardless of upload mode.
- Metrics collector on/off and timing go through one entry point: `/usr/local/bin/tte-metrics-ctl` (`status` | `apply` | `upload`), installed by `metrics/install.sh` and invoked over SSM by `instance-manager`. The lambda side only builds argv and parses the JSON status line (`_shared/shared/utils/instance/InstanceMetrics.ts`) — don't reimplement the systemctl sequence there, and don't add an uninstall path: "off" means `systemctl disable`, which deletes nothing and comes back exactly as it was. Interval bounds are mirrored in three places (the script's `*_MIN`/`*_MAX`, `METRICS_BOUNDS`, and `BOUNDS` in `InstanceMetrics.vue`); change one, change all three.
- Timer intervals are set via systemd **drop-ins**. `OnActiveSec`/`OnBootSec`/`OnStartupSec`/`OnUnitActiveSec`/`OnUnitInactiveSec` all populate **one shared list**, which cuts both ways: a drop-in that just assigns `OnUnitActiveSec` ADDS a trigger rather than replacing the shipped one (so the empty `OnUnitActiveSec=` reset is required), *and* that reset clears the entire list — including `OnBootSec`, which is not the option being reset. The drop-in therefore restates `OnBootSec` too (`COLLECT_BOOT_SEC`/`UPLOAD_BOOT_SEC` in `tte-metrics-ctl.sh`, mirroring the shipped `.timer` units). Omitting it left each timer with only `OnUnitActiveSec`, which is measured from the last activation of its *service* — a service that has never run gives no anchor, so systemd computed no elapse point and the timer sat in `SubState=elapsed` forever. `is-enabled` and `is-active` both still reported the collector as on while it had taken zero samples; `systemctl show <timer> -p TimersMonotonic` is the only place the effective list is visible, and `tte-metrics-ctl status` now reports `scheduled` so the UI can catch it. Drop-ins rather than rewriting the unit so re-running `install.sh` to pick up script changes can't clobber a configured interval.
- `tte-metrics-upload.sh` prunes the local buffer *only after* every PUT in the run succeeded. That ordering is the safety property, not an accident: under manual upload mode a buffer file can be days old and still be the only copy of that data, so the old prune-by-mtime-regardless behaviour would silently delete metrics that never reached S3. For the same reason the uploader considers the *whole* buffer tree, not just the current and previous hour.
- The metrics uploader signs its own SigV4 S3 PUTs with `curl` + `openssl` instead of shelling out to `aws s3 sync` (~1s CPU / ~100MB RSS per invocation → ~20-40ms / ~3MB, which matters because some of the fleet is single-core). Consequences worth knowing before touching it: (1) it needs only `s3:PutObject`, never `s3:ListBucket` — an older revision of `setup/README.md` claims otherwise; (2) `sync`'s remote comparison is replaced by the local `.uploaded` stamp file described above, so nothing reconciles against what is actually in the bucket; (3) the signing math is verified against AWS's published test vectors, but a regression there fails at *runtime* as a 403, so a selftest probe exists to prove signing and IAM on a fresh box — `tte-metrics-ctl upload --selftest` on the box, the SELF-TEST button on the Metrics Collector tile, or `POST /instance/{id}/metrics/upload?selftest=true`. A failed probe returns `409 SELFTEST_FAILED` carrying the S3 error code (via `describeSelftestFailure`), deliberately *not* a 500: the negative result is the output of the diagnostic, not a fault in the lambda; (4) `TTE_METRICS_UPLOADER=cli` reverts to `aws s3 sync` without a reinstall. SigV4 rejects >15 min clock drift, so chrony must be running.
- `tte-metrics-collect.sh` is the hot path — every 15-60s forever, against the uploader's every few minutes — so it is deliberately written to fork exactly **once** (a single `awk` that parses both `/proc` files, writes the CPU delta state, and appends the JSON line). It is `#!/bin/bash` rather than `sh` specifically for `printf '%(...)T'`, which replaces a `date(1)` fork on every sample. Don't add a pipeline or a `date`/`stat` call here without weighing it against that; the uploader is where per-run cost is allowed to live.
- Any SSM-backed action that answers an API Gateway request must size its poll budget against **API Gateway's 29s integration timeout**, not the lambda's own timeout. `SsmDao.ExecuteCommandGetResult` defaults to `1000ms × 30` = 30s, which is already past that line: the gateway returns a 504 while the invocation keeps running and succeeds, so the work happens, the UI reports failure, and the natural response (retry) re-runs it. The metrics actions all pass `METRICS_SSM_POLL` (`1000ms × 20`) explicitly, leaving ~9s for cold start, `SendCommand` and the response. Overrunning the budget is not data loss — the command finishes on the box regardless — so `isSsmPollTimeout` exists to distinguish "we stopped watching" from "it failed"; `triggerMetricsUpload` returns `409 UPLOAD_STILL_RUNNING` rather than an error for that case. Other callers of `ExecuteCommandGetResult` still take the 30s default and have not been audited against this.
- Desired metrics config lives on the `inst#<id>` Dynamo row (`metricsConfig`) and is written only *after* SSM reports the apply succeeded, so it never claims a setting the box isn't running. Nothing re-applies it at boot — `setup.sh`'s `metrics` step reads it back on a rebuild, which is the only reconciliation there is. That's why `writeMetricsConfig` rejects a write against a stopped instance instead of storing it for later. `setup.sh` seeds the attribute itself on a new box (`step_metrics` captures `tte-metrics-ctl status`, `step_register` writes it, same apply-then-record ordering) — otherwise a freshly provisioned instance has no stored config at all, and a rebuild silently resets it to installer defaults.
- The metrics read endpoint returns `configured` (whether `metricsConfig` exists) because `toMetricsConfig` *fabricates* defaults when it doesn't — without the flag, a box that never ran the collector reads back as a confident "Enabled, 60s sampling". The default read is Dynamo-only, so there is no `actual` to contradict it either. The tile shows "Not configured" and labels the values as defaults; only `?verify=true` can say "Not installed".
- A box with no `/usr/local/bin/tte-metrics-ctl` fails *before* it can print a status line — the shell exits 127 and `PollForCommandCompletion` throws, so `parseMetricsStatus` returning null never fires and the caller would report a 500. `isCollectorNotInstalled` catches that and all three metrics actions map it to the same 409 `COLLECTOR_NOT_INSTALLED` / `unreachable: "collector-not-installed"` they'd have produced from a parsed `installed:false`.
- TShock REST calls do **not** go out over the internet any more. `TShockAPI` (caller side) builds the request and hands it to the `tshock-proxy` lambda over a synchronous invoke; `TShockDirect` (proxy side) is the only code that speaks HTTP to an instance. This exists because the old path dialled the instance's *public* IP over plain HTTP, which put the REST account password — query-string-only, on `/v2/token/create` — on the open internet and forced port 3891 to accept traffic from `0.0.0.0/0`. Points that will break if you miss them:
  - **Dial the private IP, always.** `InstanceStatus` carries both; `publicIp` is now only what the UI displays as the player connect address. Traffic sent to a *public* address from inside the VPC hairpins out through the internet gateway and arrives with a public source address, so it will not match the source-security-group rule that keeps 3891 closed. Using the public IP doesn't fail loudly — it silently defeats the whole control.
  - **`tshock-proxy` makes no AWS API calls, and this is load-bearing, not incidental.** It sits in the VPC with no internet route, so it needs no NAT gateway (~$33/mo) and no interface endpoints. That is only true while it calls nothing: the credential and the port ride in the invoke payload for exactly this reason. Adding a Secrets Manager or DynamoDB call means also paying for an endpoint to reach it.
  - **Never `CWLogger` inside the proxy — `console.log` only.** `CWLogger` writes through the CloudWatch Logs SDK to custom log groups, which is an AWS API call and would hang until the invocation timed out. `console.log` is collected by the Lambda service and never touches the function's ENI. For the same reason the proxy needs no `FUNC_NAMES` entry.
  - **Never log the proxy's event.** `TShockProxyRequest` carries a live credential.
  - **The proxy can only reach instances in the VPC its ENIs live in.** Nothing validates this — an instance launched into a different VPC registers fine and reads healthy in the registry while every REST call to it fails.
  - **`tshock-proxy` opts out of the shared dependency set** via `"bundleSharedDependencies": false` in its `package.json`. `build.js` otherwise merges `_shared/shared`'s deps into every function, which would ship ~10MB of AWS SDK (9043 files) it never imports — measurable cold-start cost on what is now the synchronous path of every status poll. With it off the bundle is 178 files / 0.39MB and no `node_modules` at all. The unused `shared/` modules are still copied in; that's fine, because Node never resolves an import it doesn't load. Setting this on a function that *does* use the SDK fails at runtime with `ERR_MODULE_NOT_FOUND` on its first call, not at build time.
  - **TShock tokens are cached with no expiry, on purpose.** TShock does not expire REST tokens — every one ever minted stays valid until the server restarts, and nothing ever cleans them out of its in-memory table. The old client-side 5-minute TTL was therefore pure waste: it threw away a working token on a timer, paid an extra round trip to mint a replacement, and left the abandoned one live on the server forever. Invalidation is reactive instead: `isTokenRejection` in `TShockDirect` re-mints and retries once. It checks **both** the HTTP status and the body-level `status` field, because TShock mirrors the code into the body (`{"status":"200",…}`, see `serverStore`'s `=== "200"` check) and which one is authoritative on an auth failure has never been established here — a version that returns HTTP 200 with a `403` body would otherwise silently defeat the retry. Don't reintroduce a TTL; a restart is the only thing that invalidates a token, and the retry detects exactly that.
  - `DropTokenCache` is gone. Tokens live in proxy containers no other process can reach, and recovery from a server restart is the 403-triggered re-mint in `TShockDirect.Request`. What remains is `DropCredentialCache`, called *only* from `POST /server/dropcache`, and it does a different job: it forces a re-read of the REST credential from Secrets Manager, which only a secret rotation invalidates. Don't reattach it to world launch or server restart the way the old token-drop was — a restart doesn't invalidate the credential, so that would just buy a pointless Secrets Manager read on the next call, on the hot path.
- The TShock REST permission list exists in two places that must stay in sync: the docstring on `_shared/shared/utils/tshock/TShockAPI.ts` and `REST_PERMS` in `src/instance-scripts/setup/setup.sh`, which is what actually grants them on a new instance. Adding a REST call that needs a new permission without updating `REST_PERMS` yields a 403 on that one feature, on new instances only — already-provisioned boxes keep whatever their group was created with, so this won't reproduce on the existing fleet.
- The instance list is the **`inst#<id>` rows themselves** — an `envs` array (`["prod"]`, `["stage"]`, or both) on the row is the registration, read through `_shared/shared/utils/instance/InstanceRegistry.ts`. This replaced the `EC2_INSTANCE_IDS` and `AUTO_SHUTOFF_SERVER_IDS_PROD`/`_STAGE` env vars, which were three hand-synced copies of one list (`logs-manager` carried a third that nothing read) that could only reach an alias via a redeploy. Points worth knowing before changing it:
  - **The cache version row `cache#instances` lives in the *instance* table, not the system table.** The instance table is shared prod/stage; the system table is per-env. A bump written to a per-env table would never invalidate the other environment's containers, and the thing being invalidated is shared. Every write path must call `InstanceRegistry.BumpCacheVersion()` — cross-container invalidation is otherwise capped at `INSTANCE_CACHE_VERSION_POLL_MS`.
  - **A row existing is not a registration.** `setup.sh`'s `register` step seeds `validRoots`/`worldPaths`/`metricsConfig` on a fresh box without `envs`, so a provisioned-but-unregistered instance is a normal state. The registry write uses `UpdateItem`, never `PutItem`, so registering can't clobber what setup.sh wrote.
  - **`DescribeInstances` with an explicit ID list is all-or-nothing** — one terminated ID throws `InvalidInstanceID.NotFound` and takes the whole response with it. Since admins now edit this list, `GetMultipleInstanceStatus` falls back to per-ID describes and returns unresolvable IDs as `state: "missing"`. Without that, one stale row blanks the instance list *and* the editor needed to remove it.
  - Registry CRUD lives in `instance-manager` (not `system-manager`, which has neither `INSTANCE_TABLE_NAME` nor `ec2:DescribeInstances`) under `/instances/registry`, gated on `system.instances.list.read`/`write`. Deregistration deletes the `autoshutoff#<id>` row from **both** environments' system tables via `SYSTEM_TABLE_BY_ENV`, since the registration it mirrors was shared.
  - Permission strings live in **three** files that must stay in sync: `_shared/shared/permissionValues.ts` (backend), and `util/permissionValues.js` + `util/permissionsMeta.js` on the frontend — a permission missing from the meta file is not grantable in the Users page.
- `TSHOCK_OUT_LOGS`/`TSHOCK_ERR_LOGS` point at directories *inside* the instance's `logs/` (`logs/stdout`, `logs/errout`), and the launch commands redirect into them with `1>> "<root>/<date>.log"`. Shell redirection creates the file but never its parent directory, and the launch is wrapped in `systemd-run`, which reports success as soon as the unit starts — so a missing directory means TShock silently never runs, with no world file and no console output to diagnose from. `setup.sh`'s `step_layout` creates both, and `ensureLogDirsCommand()` (`_shared/shared/utils/tshock/TShockLaunch.ts`) `mkdir -p`s them in the launched script so a hand-provisioned box can't reintroduce it. Any new TShock launch path needs the same guard.
- World creation runs in `server-manager` invoked asynchronously against itself (`InvocationType: "Event"`), and the `worldgen#<instanceID>` row in the system table is the only record that a job exists. Two consequences worth keeping in mind before changing that flow: (1) a long wait in the worker must be bounded by `boundedWaitDeadline(context, …)`, never by a fixed poll count — a worker killed by the function timeout runs no catch block, so the row keeps whatever status it had and the UI polls it forever; (2) async invocation means lambda retries the worker up to twice on its own, so the worker claims the job with a conditional `workerStartedAt` write and later invocations abort rather than dispatch a second `-autocreate` at the same world file. `queueCreateWorld` refuses a new request only for a job that is still heartbeating (see `_shared/shared/utils/jobs/WorldgenJob.ts`); terminal and abandoned rows are overwritten, which is the only thing that unwedges an instance since nothing deletes the row on failure.
- Instance shutdown is an **asynchronous job**, not a request that completes before the response. `POST /instance/{id}/stop` only writes the `shutdown#<id>` row and self-invokes `instance-manager` (`requestType: "shutdown-request"`, dispatched in its `index.ts` exactly like server-manager's worldgen worker); `shutdownWorker` runs the tasks and issues the stop. This exists because the whole sequence used to run inline and therefore had to fit API Gateway's 29s integration timeout — two syncs sharing one ~25s pot, with `LOG_SYNC_BUDGET_SHARE` capping the first at half so the second wasn't starved, and no room to add a third task. `ttesm-instance-manager` is at **300s** for this reason; trimming it back re-imposes the old ceiling. The tasks themselves still run *before* `EC2.StopInstance` (SSM can't reach a box that's powering off) and are still best-effort — a failed task is recorded in `taskOutcomes` and the instance stops anyway. Multi-file syncs go through `S3.SyncTrackedFilesToS3` (batched `aws s3 sync`, uploads only what changed); `SyncInstanceFilesToS3` copies every file unconditionally and is only for single-file refresh paths. A bare `aws s3 sync` with no `--exclude "*"` + per-file `--include` filters is what caused the original "uploaded everything on disk" bug — keep the filters.
- The shutdown task list lives in exactly one place: `SHUTDOWN_TASKS` in `_shared/shared/utils/jobs/ShutdownTasks.ts`. Both the interactive stop and auto-shutoff's `handleEc2Stop` queue the same job through `queueShutdownJob`, so a task added there is a task both paths get. Each task carries its own `maxMs` rather than drawing from a shared pot. That per-task ceiling must stay under `SHUTDOWN_STALE_MS` (default 180s): the worker only heartbeats *between* tasks, so a task that can outlive the staleness window makes a live job look abandoned — which drops every guard and lets a second shutdown be queued on top of the first. Change the two together.
- **`stopping-server` must stay first in `SHUTDOWN_TASKS`.** Terraria holds the world in memory and only writes it on save, so any task that reads instance files before the server has exited captures the state as of the last autosave — and then `syncing-files` overwrites the good copy in S3 with it. The stop goes through TShock's REST API (`/v2/server/off?confirm=true`), the only path that saves and exits cleanly; a signal is a crash as far as Terraria is concerned. The wait for the process to actually disappear runs *on the box* as one SSM command polling `pgrep` (`tshockProcessPattern()`, shared with the pre-launch guard so the two can't disagree on what "running" means), not as a poll loop from the lambda. It is best-effort like every other task: a box with no server answers the REST call with a connection refusal — which `TShockAPI` reports as a wrapped `{ server: { status: false } }`, not an error — and that is the normal case on the auto-shutoff path, where the countdown already stopped the server minutes earlier.
- Shutdown state is reported on the **`instance` payload of both `GET /instance/{id}/status` and `GET /server/{id}/status`** — there is deliberately no dedicated status endpoint. Attaching it to both is mandatory, not redundant: `serverStore.fetchServerStatus` overwrites the whole `instanceStatusData[id]` entry from `data.instance`, so if only instance-manager carried it, visiting the Server page would wipe the flag out from under the tracker and the client-side guards. Polling is owned by `serverStore.trackShutdown` (not by the component that pressed STOP) so it survives navigation, and any status fetch that sees `shutdown.active` starts tracking — that is the entire reattach story for refreshes and for auto-shutoffs nobody was watching.
- The `shutdown#<id>` row is **never deleted** (unlike `worldgen#<id>`, which self-deletes 12s after completing). Liveness is `isShutdownBlocking` — non-terminal *and* still heartbeating — never "a row exists". Treating the row's presence as busy would wedge the instance permanently after its first stop, and a worker killed mid-run (no terminal status written) would wedge it with no way back; overwriting a stale row is the only recovery path. Keeping terminal rows also preserves `failureReason`/`taskOutcomes` for diagnosis.
- Anything that mutates instance or server state must call `blockIfShutdownInProgress(instanceId)` and return its result (409 `SHUTDOWN_IN_PROGRESS`) — the shutdown window is now minutes long and the user is free to navigate during it. It **returns** a response rather than throwing because `errorHandler` maps thrown errors to status codes by matching message substrings, so a throw would surface as a 500 with no code for the frontend to branch on. Reads stay unguarded. Client-side, `serverStore.isShuttingDown(id)` disables the same controls; that's UX only, the server check is the real one.
- Lambda invokes — async *and* sync (`LambdaDao.InvokeFunction` / `InvokeFunctionSync`) — must pass an **alias-qualified** target: `context.invokedFunctionArn` when self-invoking, or a qualified ARN from env cross-lambda (`INSTANCE_MANAGER_FUNCTION_ARN`, `TSHOCK_PROXY_FUNCTION_ARN`; both are *unqualified* base ARNs in the env var, with `vars.ts` appending `:prod`/`:stage`). `LambdaDao.InvokeFunction` used to default to `AWS_LAMBDA_FUNCTION_NAME`, which is *unqualified*, so the invoke landed on `$LATEST` — whose `ACTIVE_ENV` is whichever branch deployed most recently. A worker that picks its Dynamo tables and its target EC2 instance from `ACTIVE_ENV` would then act on the wrong environment, silently and only sometimes. The parameter is now **required** precisely so this can't be reintroduced by omission; don't add a default back. (`SchedulerDao.UpsertOneTimeSchedule` already does the same thing via its `targetArn` — auto-shutoff's follow-up timers pass `context.invokedFunctionArn`. The `api-authorizer` is unrelated: it resolves its environment from the API Gateway method ARN per request, not from `ACTIVE_ENV`.)

---

## Assistant Checklist Before Committing
- Does this change respect auth/permissions boundaries?
- Are env variables documented (here, if new)?
- Are routes and stores consistent with conventions?
- Are logs structured and errors informative?
- If you touched something this file documents and the docs no longer match, update this file too.

If infra specifics differ, adapt endpoints/vars but keep the above architecture principles intact.
