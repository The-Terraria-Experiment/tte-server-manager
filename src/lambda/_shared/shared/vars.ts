/// <reference types="node" />

export const PERM_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-user-perms" : "ttesm-user-perms-stage";
export const SYSTEM_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-system" : "ttesm-system-stage";
export const LOGS_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-player-logs" : "ttesm-player-logs-stage";
export const WORLD_CREATE_KEY = "worldgen";
export const ROLE_KEY_PREFIX = "role#";