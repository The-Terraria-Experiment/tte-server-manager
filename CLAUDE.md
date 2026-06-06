# AI Coding Agent Instructions — tte-server-manager

These instructions guide AI assistants working on this repository. Keep changes minimal, focused, and consistent with the existing Vue + Vite stack. Prefer incremental PRs.

---

## Overview
- **Goal:** Server management interface for Terraria/TShock/TModLoader running on EC2.
- **Stack:** Vue 3 SPA (Vite, Pinia, Vue Router, Tailwind) hosted via AWS Amplify Hosting; API Gateway → Lambda; Amplify Auth (Cognito) with built-in flows; DynamoDB permissions; Secrets Manager; CloudWatch; EC2 with SSM; S3 for game files; TShock REST API.
- **Scalability:** Design for multiple `Instance` and `GameServer` entities (no hardcoding single IDs).
## Environments

The application runs in three environments with distinct deployment strategies and shared infrastructure:

### Production (Prod)
- **URL:** `server.terrariaexperiment.click`
- **Git Branch:** `main`
- **Frontend:** Amplify Hosting (auto-deploy on push to main)
- **Backend:** API Gateway → Lambda functions (prod alias)
- **Auth:** Cognito User Pool (prod)

### Staging (Stage)
- **URL:** `stg-server.terrariaexperiment.click`
- **Git Branch:** `stage`
- **Frontend:** Amplify Hosting (auto-deploy on push to stage)
- **Backend:** API Gateway → Lambda functions (stage alias)
- **Auth:** Cognito User Pool (stage)

### Development (Dev)
- **URL:** `localhost:5173` (Vite dev server)
- **Git Branch:** `dev/*` (feature branches; all dev branches start with `dev/`)
- **Frontend:** Local Vite dev server (`npm run dev`)
- **Backend:** Uses stage backend (same API Gateway & Lambda stage aliases as staging)
- **Auth:** Uses stage Cognito User Pool

### Shared Resources & Separation

**Lambda Functions:**
- Prod and stage share the same Lambda function code deployed to the same functions
- Separation via **Lambda aliases**: `prod` alias vs `stage` alias
- Each alias can have distinct environment variables and concurrency settings

**DynamoDB Tables:**
- **Shared across prod/stage:** Tables related to EC2 instances (instance metadata, status)
  - Justification: EC2 instances are shared infrastructure accessed by both environments
- **Separate per environment:** All other tables including:
  - User data (`UserData`)
  - Permission entries (`PermissionEntries`)
  - Tool logs (`ToolLogs`)
  - System notices
- **Naming convention:** Environment-specific tables use prefix/suffix (e.g., `prod-UserData`, `stage-UserData`)

**EC2 Instances:**
- All environments can access all EC2 instances
- Single fleet of instances shared across prod, stage, and dev
- Instance management commands (start/stop/restart) are available in all environments

**S3 Buckets:**
- Common buckets between environments

**Secrets Manager:**
- Common secrets between environments

### Development Workflow
1. **Local development:** Work on `dev/*` branches; run frontend locally; calls stage backend.
2. **Staging:** Merge to `stage` branch; Amplify auto-deploys to `stg-server.terrariaexperiment.click`.
3. **Production:** Merge `stage` → `main`; Amplify auto-deploys to `server.terrariaexperiment.click`.

### Environment Variable Patterns
- Lambda env vars include `ACTIVE_ENV` (prod/stage) to determine which DynamoDB tables/S3 buckets to access.
- Frontend `.env` files (`.env.production`, `.env.staging`, `.env.development`) configure `VITE_API_BASE_URL` and Cognito settings per environment.

---


## Architecture
- **Web Interface:** Vue SPA built with Vite; deployed on AWS Amplify Hosting (build/deploy pipeline managed by Amplify).
- **API Layer:** API Gateway with REST endpoints; JWT from Cognito (ID token) forwarded by frontend; Lambda authorizer optional.
- **Lambda Functions (examples):**
  - `PermValidator`: validates requested actions against Dynamo permissions.
  - `TShockManager`: calls TShock REST API (token in Secrets Manager).
  - `EC2Manager`: start/stop/restart instance, SSM commands, status.
  - `DynamoPermManager`: CRUD for permission entries, user roles.
- **Auth:** Amplify Auth (Cognito User Pool) using Amplify's hosted flow and configured providers; roles map to app permissions.
- **Data:** DynamoDB tables
  - `PermissionEntries` (PK: `tenant#<id>`, SK: `perm#<resource>#<action>`)
  - `UserData` (PK: `user#<sub>`, attributes: profile, roles)
  - `ToolLogs` (PK: `log#<date>`, SK: `action#<id>`) for audit
- **Files:** S3 buckets for `Config Files` and `World Files`; synced to EC2 via SSM; API Gateway returns pre-signed URLs.
- **Secrets/IAM:** TShock token in Secrets Manager; Lambda roles least-privilege (S3, Dynamo, EC2, SSM, Secrets);
- **Observability:** CloudWatch logs/metrics; structured logs (JSON) from Lambdas.

## Frontend Conventions
- **Framework:** Vue 3 + Vite (JavaScript). Avoid TypeScript unless requested.
- **Routing:** `src/router/index.js` defines pages; routes use `meta.requiresAuth` when protected.
- **State:** Pinia stores in `src/stores/`; expose getters/actions; do not mutate state outside actions.
- **Components:**
  - Pages: `src/components/pages/` (Overview, Instance, Server, Users, etc.)
  - Shared/Common UI: `src/components/shared/`, `src/components/common/`
- **Styling:** Tailwind utility classes; keep class lists concise; theme in `src/theme.css` and `src/style.css`.
- **API Calls:** Centralize fetch logic; include Cognito ID token in `Authorization: Bearer <token>` when calling API Gateway.
- **UX:** Navigation components (`DesktopNav.vue`, `MobileNav.vue`) mirror router; highlight selected route via helper.

## Backend Integration Points (Contract)
- **Headers:** `Authorization: Bearer <cognitoIdToken>`; `Content-Type: application/json`.
- **Endpoints (examples — define precisely in infra):**
  - `GET /instances` → list instances and status
  - `GET /instances/{id}` → instance detail
  - `POST /instances/{id}/start` | `POST /instances/{id}/stop` | `POST /instances/{id}/restart`
  - `GET /servers` | `GET /servers/{id}` → TShock status
  - `POST /servers/{id}/command` { command }
  - `GET /files/config` | `GET /files/worlds` → list via S3
  - `POST /files/upload` → pre-signed PUT
  - `POST /files/sync-to-ec2` { instanceId, paths }
  - `GET /permissions` → current user effective permissions
  - `POST /permissions/grant` | `POST /permissions/revoke`
- **Errors:** Return JSON `{ code, message, details? }`; 4xx for validation/permission; 5xx for server.

## Environment & Configuration
- **Frontend `.env` keys (Vite):**
  - `VITE_API_BASE_URL` (API Gateway URL)
  - `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION`
  - Optional: `VITE_AMPLIFY_APP_URL`
- **Lambda env vars:** `AWS_REGION`, `DYNAMO_TABLE_PERMISSIONS`, `DYNAMO_TABLE_USERS`, `DYNAMO_TABLE_TOOL_LOGS`, `TSHOCK_SECRET_NAME`, `S3_BUCKET_CONFIG`, `S3_BUCKET_WORLDS`, `EC2_INSTANCE_IDS` (CSV), `ALLOW_MULTI_INSTANCE=true`.
- **Secrets:** TShock API token in Secrets Manager under `TSHOCK_SECRET_NAME`.

## Security & Permissions
- **Least privilege:** IAM roles only grant exact actions (Dynamo, S3, EC2:Start/Stop, SSM:SendCommand, Secrets:GetSecretValue).
- **Validation:** Every action goes through `PermValidator` with user `sub` and resource/action.
- **Audit:** Write compact JSON logs to CloudWatch and `ToolLogs` for admin actions.
- **CORS:** Restrict origins to the Amplify app domain; allow `Authorization` header.

## Developer Workflows
- **Install & run:**
  ```bash
  npm install
  npm run dev
  ```
- **Build & preview:**
  ```bash
  npm run build
  npm run preview
  ```
- **Frontend patterns:**
  - Add new page: create component in `src/components/pages/`, register route in `src/router/index.js`, protect with `meta.requiresAuth` if needed.
  - Use Pinia stores for shared state; avoid global singletons outside stores.
- **Testing:** Prefer `vitest` for unit tests and minimal component tests; mock API with simple handlers.
- **CI/CD (placeholder):** Lint, build, upload `dist/` to S3; invalidate CloudFront; deploy Lambdas via IaC (CDK/Terraform) outside this repo.

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

---

## Assistant Checklist Before Committing
- Does this change respect auth/permissions boundaries?
- Are env variables documented?
- Are routes and stores consistent with conventions?
- Are logs structured and errors informative?

If infra specifics differ, adapt endpoints/vars but keep the above architecture principles intact.
