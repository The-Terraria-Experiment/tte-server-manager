import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { LOGS_TABLE } from "../shared/vars.js";
import type { LogDataEntry, PayloadSchemaV1 } from "../shared/schema/LogsTable.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";

export const pushLog = async (event: AuthorizedEvent, context: Context) => {
	const serverID = event.pathParameters?.id;

	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	const payload = event.parsedBody as PayloadSchemaV1;
	const entry: LogDataEntry = {
		serverID: `server#${serverID}`,
		timestamp: Date.parse(payload.occurredAtUtc),
		eventType: payload.eventType,
		worldName: payload.server.worldName,
		playerName: payload.player.name,
		accountName: payload.player.accountName,
		playerGroup: payload.player.groupName,
		ip: payload.player.ipAddress,
		isLoggedIn: payload.player.isLoggedIn,
		playersActive: payload.server.activePlayers,
		logID: payload.correlationId,
		versions: {
			schema: payload.schemaVersion,
			plugin: payload.pluginVersion,
			server: payload.server.version
		},
		expireAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 1 month
	};

	const DB = new DynamoDao();

	const success = await DB.PutItem(LOGS_TABLE, entry);

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
