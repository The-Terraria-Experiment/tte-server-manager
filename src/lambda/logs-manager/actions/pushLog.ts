import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { IGNORE_UNKNOWN_SOURCE_LOGS, LOGS_TABLE, SYSTEM_TABLE } from "../shared/vars.js";
import { PlayerEvent, type LogDataEntry, type PayloadSchemaV1 } from "../shared/schema/LogsTable.js";
import type { AutoShutoffStateEntry } from "../shared/schema/SystemTable.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";

export const pushLog = async (event: AuthorizedEvent, context: Context) => {
	const serverID = event.pathParameters?.id;

	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	const payload = event.parsedBody as PayloadSchemaV1 | undefined;

	if (!payload || !payload.eventType) {
		return ResponseUtil.ValidationError("A valid log payload is required");
	}

	// Optionally drop logs with no observed player data (e.g. pre-join disconnects)
	// when the environment is configured to ignore them. Acknowledge with success so
	// the client doesn't treat it as a failure and retry.
	if (IGNORE_UNKNOWN_SOURCE_LOGS && payload.playerDataSource === "unknown") {
		return ResponseUtil.Success({ success: true, ignored: true });
	}

	// player/server objects (and their fields) can be partial or absent on some
	// events — notably player.leave, where the client has already disconnected —
	// so read them defensively to avoid throwing a 500 on a malformed payload.
	const player = payload.player ?? ({} as Partial<PayloadSchemaV1["player"]>);
	const server = payload.server ?? ({} as Partial<PayloadSchemaV1["server"]>);

	const parsedTimestamp = Date.parse(payload.occurredAtUtc);
	const logTimestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();
	const entry: LogDataEntry = {
		serverID: `server#${serverID}`,
		timestamp: logTimestamp,
		eventType: payload.eventType,
		worldName: server.worldName,
		playerName: player.name || "unknown",
		accountName: player.accountName,
		playerGroup: player.groupName,
		ip: player.ipAddress,
		isLoggedIn: player.isLoggedIn,
		playersActive: server.activePlayers,
		logID: payload.correlationId,
		...(payload.playerDataSource ? { playerDataSource: payload.playerDataSource } : {}),
		versions: {
			schema: payload.schemaVersion,
			plugin: payload.pluginVersion,
			server: server.version
		},
		expireAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 1 month
	};

	const DB = new DynamoDao();

	const success = await DB.PutItem(LOGS_TABLE, entry);
	if (success && isPlayerEvent(payload.eventType)) {
		const autoShutoffKey = `autoshutoff#${serverID}`;
		await DB.UpdateItem(SYSTEM_TABLE, autoShutoffKey, {
			updates: {
				serverId: serverID,
				lastPlayerLogAt: logTimestamp,
				lastPlayersActive: server.activePlayers,
				lastPlayerEventType: payload.eventType,
				lastUpdatedAt: Date.now(),
			} satisfies AutoShutoffStateEntry,
		});
	}

	if (!success) {
		CWLogger.Error(FUNC_NAMES.LOG_MGR, {
			action: "log-event",
			error: "Put log failed",
			details: {
				payload,
				builtTableEntry: entry
			}
		});
	}

	return ResponseUtil.Success({ success });
};

function isPlayerEvent(eventType: PayloadSchemaV1["eventType"]): eventType is PlayerEvent {
	return Object.values(PlayerEvent).includes(eventType as PlayerEvent);
}
