/// <reference types="node" />

export const PERM_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-user-perms" : "ttesm-user-perms-stage";
export const SYSTEM_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-system" : "ttesm-system-stage";
export const LOGS_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-player-logs" : "ttesm-player-logs-stage";
export const USER_ARCHIVE_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-user-archive" : "ttesm-user-archive-stage";
export const WORLD_CREATE_KEY = "worldgen";
export const ROLE_KEY_PREFIX = "role#";
export const COGNITO_USER_POOL_ID =
	process.env.ACTIVE_ENV === "prod"
		? process.env.COGNITO_USER_POOL_ID_PROD
		: process.env.COGNITO_USER_POOL_ID_STAGE;