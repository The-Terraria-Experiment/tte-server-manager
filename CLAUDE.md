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
- **`src/instance-scripts/`**: shell/systemd assets that run *on the EC2 instances*, not in Lambda. Not built or deployed by any pipeline in this repo — staged onto a box and installed by hand (or via SSM Run Command). Contains `metrics/` (the CPU/mem collector, see below) and `setup/` (full instance provisioning: AWS CLI, dotnet, file layout, TShock from S3, metrics, SSM agent, and the TShock REST account). `setup/setup.sh` runs over SSH rather than SSM because it installs the SSM agent itself; it invokes `../metrics/install.sh`, so the whole `instance-scripts/` directory has to be staged together.

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
  - `instance-manager`: EC2 instance list/start/stop/restart, file browsing/upload/download/sync via SSM+S3.
  - `server-manager`: TShock server control — status, run command, manage bans/players, config read/write, world create/launch.
  - `user-manager`: user permissions (read/write), username, Patreon account linking, user deletion.
  - `system-manager`: roles, system notices, Patreon tier map, auto-shutoff pause/cancel.
  - `auto-shutoff-manager`: idle-EC2 detection/shutdown (`AUTO_SHUTOFF_*` env vars). Invoked directly by EventBridge Scheduler: a recurring per-env tick, plus one-time schedules it creates for itself to drive the staged countdown (warn at 10/5/2 min → stop server → stop EC2). See the auto-shutoff gotcha below before changing how steps are scheduled.
  - `logs-manager`: TShock console log listing/search/transcript retrieval from S3.
  - `cognito-user-link`: Cognito trigger(s) linking Patreon-federated identities to app users; resolves its tables from the invoking user pool.
  - `patreon-oidc`: standalone OIDC shim exposing Patreon's OAuth2 API as a Cognito-compatible external IdP (`/authorize`, `/callback`, `/token`, `/jwks`, `/userinfo`, `/.well-known/openid-configuration`, mounted under `/auth/patreon/*`). Called by Cognito and Patreon directly, not by the frontend, so it bypasses the shared action/permission middleware.
  - `_shared`: middleware, AWS client wrappers (`DynamoDB`, `S3`, `EC2`, `SSM`, `Cognito`, `CloudWatch`, `SecretsManager`, `Lambda`, `Scheduler`), and utils (`TShockAPI`, `TShockConfig`, `Perms`, etc.) used by all of the above.
- **Auth:** Cognito User Pool (Amplify Gen 2 backend, config in `src/tte-server-manager/amplify/`), federated with the in-house `patreon-oidc` Lambda so Patreon is the identity source; permission checks are per-user, resolved from a permissions table keyed by `user#<sub>` and enforced both client-side (`hasPermissions` in `userStore`, gating UI + `apiRequest` calls) and server-side (each lambda's action handlers).
- **Data:** DynamoDB — permission/user-link data, instance metadata/status, system notices, Patreon tier map, roles. Table names/keys are supplied via env vars per function rather than fixed constants; verify the current schema in `_shared/shared/utils/Perms.ts` and the relevant `_shared/shared/aws/DynamoDB.ts` callers before assuming structure.
- **Files:** S3 buckets for the instance filestore (`S3_FILESTORE_NAME`), TShock config (`S3_CONFIG_BUCKET_NAME`), and console logs + instance metrics (`S3_LOGS_BUCKET_NAME`, under the `tshock-console/` and `metrics/` prefixes respectively); synced to/from EC2 via SSM; world/instance files served through `instance-manager`. The filestore is the source of truth for which instance files are *tracked*: whatever exists under `{instanceId}/` is what gets browsed, downloaded, and re-synced on shutdown — so anything that lands there stays tracked until explicitly deleted.
- **Secrets/IAM:** TShock REST token in Secrets Manager (`TSHOCK_SECRET_NAME`); Patreon OAuth creds, OIDC signing key, relay-state and link-intent secrets also in Secrets Manager; Lambda roles least-privilege (S3, Dynamo, EC2, SSM, Secrets).
- **Observability:** CloudWatch logs via the shared `CWLogger`; structured logs from Lambdas. Instance-level CPU/memory is *not* on CloudWatch custom metrics — a homebrew collector (`src/instance-scripts/metrics/`) samples `/proc` on a systemd timer and pushes JSONL to the logs bucket under `metrics/{instanceId}/YYYY/MM/DD/HH.jsonl`. The free built-in EC2 metrics (CPU, network, disk I/O, status checks) are still in CloudWatch and still free; only the paid custom series were replaced.

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
  - `GET /instances` → list instances and status
  - `GET /instance/{id}/status` | `GET /instance/{id}/files`
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
  - `EC2_INSTANCE_IDS` (CSV), `SSM_FILE_TREE_DOCUMENT`, `SSM_FILE_TREE_IGNORE_DIRS`
  - `TSHOCK_SECRET_NAME`, `TSHOCK_API_PORT`, `TSHOCK_PATH`, `TSHOCK_WD`, `TSHOCK_OUT_LOGS`, `TSHOCK_ERR_LOGS`
  - `WORLD_CREATE_POLL_DELAY_MS`, `WORLD_CREATE_STABLE_COUNT`, `WORLD_CREATE_UPLOAD_RESERVE_MS` (wall-clock the worldgen worker keeps for the S3 upload after the world file is ready), `WORLD_CREATE_STALE_MS` (how long a worldgen job may go without a heartbeat before it's treated as abandoned). `WORLD_CREATE_POLL_ATTEMPTS` is **obsolete** — the wait is bounded by the lambda's own remaining time now, so the function timeout is the knob; the var is still set on `ttesm-server-manager` but no longer read.
  - `AUTO_SHUTOFF_IDLE_MINUTES`, `AUTO_SHUTOFF_EC2_DELAY_MINUTES`, `AUTO_SHUTOFF_SERVER_IDS_PROD`/`_STAGE` (falls back to `AUTO_SHUTOFF_SERVER_IDS`), `AUTO_SHUTOFF_SCHEDULER_ROLE_ARN` (role EventBridge Scheduler assumes to invoke this lambda)
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
- The instance metrics collector flushes on shutdown through its own `tte-metrics-flush.service` (`ExecStop`, `TimeoutStopSec=20`), deliberately *not* through the lambda-side shutdown sync. Don't move it there: that path is on a tight deadline budget it would eat into, and anything landing in the filestore stays *tracked* forever.
- The TShock REST permission list exists in two places that must stay in sync: the docstring on `_shared/shared/utils/TShockAPI.ts` and `REST_PERMS` in `src/instance-scripts/setup/setup.sh`, which is what actually grants them on a new instance. Adding a REST call that needs a new permission without updating `REST_PERMS` yields a 403 on that one feature, on new instances only — already-provisioned boxes keep whatever their group was created with, so this won't reproduce on the existing fleet.
- New instances aren't discoverable until their ID is added to the `EC2_INSTANCE_IDS` lambda env var (read by `instance-manager`'s `list`) *and* an `inst#<id>` row with `validRoots`/`worldPaths` exists in the instance table (`launchWorld` resolves the world path nickname from it). `setup.sh`'s `register` step writes the Dynamo row automatically (guarded so it won't overwrite a row someone has since hand-edited). `EC2_INSTANCE_IDS` stays a manual, off-box step by design — `update-function-configuration` replaces the whole variable map rather than merging, so doing it from the instance's own IAM role would need write access to Lambda config broad enough to blow away every other hand-set var on that function. `setup.sh` prints the exact commands to run from your own machine instead.
- `TSHOCK_OUT_LOGS`/`TSHOCK_ERR_LOGS` point at directories *inside* the instance's `logs/` (`logs/stdout`, `logs/errout`), and the launch commands redirect into them with `1>> "<root>/<date>.log"`. Shell redirection creates the file but never its parent directory, and the launch is wrapped in `systemd-run`, which reports success as soon as the unit starts — so a missing directory means TShock silently never runs, with no world file and no console output to diagnose from. `setup.sh`'s `step_layout` creates both, and `ensureLogDirsCommand()` (`_shared/shared/utils/TShockLaunch.ts`) `mkdir -p`s them in the launched script so a hand-provisioned box can't reintroduce it. Any new TShock launch path needs the same guard.
- World creation runs in `server-manager` invoked asynchronously against itself (`InvocationType: "Event"`), and the `worldgen#<instanceID>` row in the system table is the only record that a job exists. Two consequences worth keeping in mind before changing that flow: (1) a long wait in the worker must be bounded by `boundedWaitDeadline(context, …)`, never by a fixed poll count — a worker killed by the function timeout runs no catch block, so the row keeps whatever status it had and the UI polls it forever; (2) async invocation means lambda retries the worker up to twice on its own, so the worker claims the job with a conditional `workerStartedAt` write and later invocations abort rather than dispatch a second `-autocreate` at the same world file. `queueCreateWorld` refuses a new request only for a job that is still heartbeating (see `_shared/shared/utils/WorldgenJob.ts`); terminal and abandoned rows are overwritten, which is the only thing that unwedges an instance since nothing deletes the row on failure.
- The shutdown file sync runs *before* `EC2.StopInstance` (SSM can't reach a box that's powering off), so anything slow there costs the stop itself. Its wait budget must come from `shutdownSyncDeadline(context)` — a fixed poll ceiling silently outgrew both callers' lambda timeouts (30s / 15s) and killed the invocation before it ever issued the stop. Multi-file syncs go through `S3.SyncTrackedFilesToS3` (batched `aws s3 sync`, uploads only what changed); `SyncInstanceFilesToS3` copies every file unconditionally and is only for single-file refresh paths. A bare `aws s3 sync` with no `--exclude "*"` + per-file `--include` filters is what caused the original "uploaded everything on disk" bug — keep the filters.

---

## Assistant Checklist Before Committing
- Does this change respect auth/permissions boundaries?
- Are env variables documented (here, if new)?
- Are routes and stores consistent with conventions?
- Are logs structured and errors informative?
- If you touched something this file documents and the docs no longer match, update this file too.

If infra specifics differ, adapt endpoints/vars but keep the above architecture principles intact.
