import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import type { AutoShutoffStateEntry } from "../shared/schema/SystemTable.js";

type CancelBody = {
	serverId?: string;
};

export const cancelAutoShutoff = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as CancelBody;
	const serverId = body.serverId;

	if (!serverId) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	const DB = new DynamoDao();

	const shutoffState = await DB.GetItem(SYSTEM_TABLE, `autoshutoff#${serverId}`) as AutoShutoffStateEntry | null;
	if (!shutoffState?.scheduledShutdownAt) {
		return ResponseUtil.ValidationError("No scheduled auto-shutoff");
	}
	if (shutoffState.pauseUntilAt) {
		return ResponseUtil.ValidationError("Auto-shutoff is paused");
	}

	const autoShutoffKey = `autoshutoff#${serverId}`;
	await DB.UpdateItem(SYSTEM_TABLE, autoShutoffKey, {
		updates: {
			serverId,
			canceled: true,
			scheduledShutdownAt: null,
			sequenceStage: "canceled-manual",
			sequenceUpdatedAt: Date.now(),
			lastUpdatedAt: Date.now(),
		} satisfies AutoShutoffStateEntry,
	});

	return ResponseUtil.Success({ success: true, serverId });
};
