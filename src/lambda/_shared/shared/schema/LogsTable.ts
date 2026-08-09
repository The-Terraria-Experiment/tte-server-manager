/**
 * Indexes:
 * 
 * | Use             | Index name | Primary Key | Sort Key  |
 * |-----------------|------------|-------------|-----------|
 * | Full timeline   | default    | serverID    | timestamp |
 * | Specific player | player     | playerName  | timestamp |
 * | Specific event  | event      | eventType   | timestamp |
 */
export type LogDataEntry = {
	serverID?: string,	// (pk)
	timestamp?: number,	// (sk) epoch timestamp
	eventType?: PlayerEvent | ServerEvent,	
	worldName?: string,
	playerName?: string,
	accountName?: string,
	playerGroup?: string,
	ip?: string,
	isLoggedIn?: boolean,
	playersActive?: number,
	logID?: string,
	playerDataSource?: PlayerDataSource,
	additional?: Record<string, any>,
	versions?: {
		schema: string,
		plugin: string,
		server: string
	},
	expireAt: number,
};

/**
 * Provenance of the player.* fields on an entry:
 * - "live":    read from a live player object at event time (fully trustworthy).
 * - "cached":  the live player was already gone; fields come from the plugin's
 *              last-known snapshot for that connection and may be a moment stale.
 * - "unknown": no player data was ever observed (e.g. pre-join disconnect);
 *              playerName falls back to "unknown".
 */
export type PlayerDataSource = "live" | "cached" | "unknown";

export enum PlayerEvent {
	JOIN = "player.join",
	LEAVE = "player.leave",
	CHAT = "player.chat",
	DEATH = "player.death",
	SPAWN = "player.spawn",
};

export enum ServerEvent {
	SAVE = "world.save",
	RELOAD = "server.reload",
};

export type PayloadSchemaV1 = {
	schemaVersion: "1.0",
	eventType: PlayerEvent | ServerEvent,
	occurredAtUtc: string,
	correlationId: string,
	pluginVersion: string,
	playerDataSource?: PlayerDataSource,
	server: {
		name: string,
		worldName: string,
		activePlayers: number,
		maxSlots: number,
		version: string
	},
	player: {
		index: number,
		name: string,
		accountName: string,
		groupName: string,
		ipAddress: string,
		isLoggedIn: boolean
	},
	eventData: any
};
	