/// <reference types="node" />

export const PERM_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-user-perms" : "ttesm-user-perms-stage";
export const SYSTEM_TABLE_PROD = "ttesm-system";
export const SYSTEM_TABLE_STAGE = "ttesm-system-stage";
export const SYSTEM_TABLE = process.env.ACTIVE_ENV === "prod" ? SYSTEM_TABLE_PROD : SYSTEM_TABLE_STAGE;
/**
 * Every environment name a registry entry's `envs` may contain, and the system table each maps to.
 * Deregistering an instance has to clean up per-env rows (`autoshutoff#<id>`) in environments other
 * than the invoking one, since the instance table those registrations live in is shared.
 */
export const ENVIRONMENTS = ["prod", "stage"] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];
export const SYSTEM_TABLE_BY_ENV: Record<EnvironmentName, string> = {
	prod: SYSTEM_TABLE_PROD,
	stage: SYSTEM_TABLE_STAGE,
};
/** The environment this lambda invocation is running as. `stage` is the safe default — dev uses it too. */
export const CURRENT_ENV: EnvironmentName = process.env.ACTIVE_ENV === "prod" ? "prod" : "stage";
export const LOGS_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-player-logs" : "ttesm-player-logs-stage";
export const USER_ARCHIVE_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-user-archive" : "ttesm-user-archive-stage";
// When "true", incoming logs whose player data provenance is "unknown" (no player
// data was ever observed, e.g. a pre-join disconnect) are dropped rather than stored.
export const IGNORE_UNKNOWN_SOURCE_LOGS = process.env.IGNORE_UNKNOWN_SOURCE_LOGS === "true";
export const WORLD_CREATE_KEY = "worldgen";
export const SHUTDOWN_KEY = "shutdown";
// Alias-qualified ARN of instance-manager, so a cross-lambda async invoke lands on the same
// environment's alias rather than $LATEST (whose ACTIVE_ENV is whichever branch deployed last).
export const INSTANCE_MANAGER_FUNCTION_ARN =
	process.env.ACTIVE_ENV === "prod"
		? (process.env.INSTANCE_MANAGER_FUNCTION_ARN + ":prod")
		: (process.env.INSTANCE_MANAGER_FUNCTION_ARN + ":stage");
export const ROLE_KEY_PREFIX = "role#";
export const PATREON_TIERMAP_KEY_PREFIX = "patreontier#";
export const PATREON_CODE_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-patreon-oidc-codes" : "ttesm-patreon-oidc-codes-stage";
export const PATREON_SHIM_BASE_URL =
	process.env.ACTIVE_ENV === "prod"
		? process.env.PATREON_SHIM_BASE_URL_PROD
		: process.env.PATREON_SHIM_BASE_URL_STAGE;
export const PATREON_OIDC_ISSUER_URL =
	process.env.ACTIVE_ENV === "prod"
		? process.env.ISSUER_URL_PROD
		: process.env.ISSUER_URL_STAGE;
export const PATREON_LINK_APP_ORIGIN =
	process.env.ACTIVE_ENV === "prod"
		? process.env.APP_ORIGIN_PROD
		: process.env.APP_ORIGIN_STAGE;
export const COGNITO_USER_POOL_ID =
	process.env.ACTIVE_ENV === "prod"
		? process.env.COGNITO_USER_POOL_ID_PROD
		: process.env.COGNITO_USER_POOL_ID_STAGE;
