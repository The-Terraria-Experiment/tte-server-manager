import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { IGNORE_UNKNOWN_SOURCE_LOGS, LOGS_TABLE, SYSTEM_TABLE } from "../shared/vars.js";
import { PlayerEvent, type LogDataEntry, type PayloadSchemaV1 } from "../shared/schema/LogsTable.js";
import type { AutoShutoffStateEntry } from "../shared/schema/SystemTable.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Realtime } from "../shared/utils/realtime/RealtimePublisher.js";
import { LambdaDao } from "../shared/aws/Lambda.js";
import { SERVER_MANAGER_FUNCTION_ARN } from "../shared/vars.js";
import {
	isScanActive,
	readItemRules,
	INVENTORY_SCAN_REQUEST_TYPE,
	type InventoryScanRequestData,
} from "../shared/utils/jobs/ItemRuleScan.js";

/**
 * Events that change the player roster, and therefore the only ones worth notifying browsers about.
 *
 * Chat, death and spawn are deliberately excluded. A connected client's response to an event is a
 * refetch of `GET /server/{id}/status`, which goes through `tshock-proxy` to the actual game server —
 * so publishing on chat would turn ten messages a minute across five operators into fifty extra TShock
 * round trips a minute against a box that is sometimes single-core. Nothing currently renders deaths or
 * spawns at all. Both already land in the logs table for `BrowseLogs` to read on demand; a live chat
 * feed is a payload-carrying feature with its own permission, not something to get for free here.
 */
const ROSTER_EVENTS = new Set<string>([PlayerEvent.JOIN, PlayerEvent.LEAVE]);

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
		additional: payload.eventData,
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

	// Published after the writes, never before: the client's reaction is a REST refetch, so an event
	// that outran its own write would have every browser read pre-write state, render it, and receive
	// no second event. Awaited (Lambda freezes this environment the moment the handler settles, so a
	// floating publish may never complete) but incapable of throwing — a notification failure must not
	// turn a stored log into a 500 that makes the plugin retry it.
	if (success && ROSTER_EVENTS.has(payload.eventType)) {
		await Realtime.PublishServerPlayers(serverID, payload.eventType);
		await requestInventoryScan(serverID);
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

/**
 * Wakes `server-manager`'s snapshot drain, if this instance has item rules switched on.
 *
 * The rules read is what keeps the feature free when it isn't in use: one GetItem against a table
 * this handler already writes, and no invoke, no TShock round trip, nothing on the game server.
 *
 * Sent on **leave** as well as join, even though only join captures are evaluated. The plugin holds
 * snapshots in memory for an hour; if only joins drained the cursor, a leave capture on a quiet
 * server would expire before anything ever read past it — and leave captures are what the next
 * feature here is going to want. The scan's lease collapses the extra wake-ups into the drain that
 * is already running, so the marginal cost is this GetItem and a queued invoke.
 *
 * Cannot throw, for the same reason the publish above cannot: a stored log must not come back as a
 * 500 and make the plugin retry a log it already delivered.
 */
async function requestInventoryScan(serverID: string): Promise<void> {
	// The RAW env var: vars.ts appends the alias, so an unset var arrives as "undefined:stage". Also
	// the per-environment kill switch, matching how Realtime.Publish handles its own ARN.
	if (!process.env.SERVER_MANAGER_FUNCTION_ARN) {
		return;
	}

	try {
		// `isScanActive`, not `hasActiveRules`: snapshot archiving is switched independently of the rule
		// list, so an instance with no rules but archiving on still needs the drain woken. Either way
		// this stays one GetItem per roster event when everything is off.
		const rules = await readItemRules(serverID);
		if (!isScanActive(rules)) {
			return;
		}

		const request: InventoryScanRequestData = {
			requestType: INVENTORY_SCAN_REQUEST_TYPE,
			instanceID: serverID,
			requestedBy: "[log-event]",
			reason: "player-event",
		};

		await new LambdaDao().InvokeFunction(request, SERVER_MANAGER_FUNCTION_ARN);
	} catch (error) {
		CWLogger.Error(FUNC_NAMES.LOG_MGR, {
			action: "request-inventory-scan",
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			details: { serverID },
		});
	}
}
