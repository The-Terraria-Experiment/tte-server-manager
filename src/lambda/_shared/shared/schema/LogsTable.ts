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
	versions?: {
		schema: string,
		plugin: string,
		server: string
	},
	expireAt: number,
};

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
	