/// <reference types="node" />

export const PERM_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-user-perms" : "ttesm-user-perms-stage";
export const SYSTEM_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-system" : "ttesm-system-stage";
export const WORLD_CREATE_KEY = "worldgen";