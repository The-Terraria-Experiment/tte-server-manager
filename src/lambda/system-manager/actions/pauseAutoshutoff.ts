import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import type { AutoShutoffStateEntry } from "../shared/schema/SystemTable.js";

type PauseBody = {
	serverId?: string;
	pauseUntilAt?: number;
};

export const pauseAutoshutoff = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as PauseBody;
	const serverId = body.serverId;
	const pauseUntilAt = body.pauseUntilAt;

	if (!serverId) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	if (typeof pauseUntilAt !== "number" && pauseUntilAt !== null) {
		return ResponseUtil.ValidationError("pauseUntilAt is required and must be a number");
	}

	const DB = new DynamoDao();
	const autoShutoffKey = `autoshutoff#${serverId}`;
	await DB.UpdateItem(SYSTEM_TABLE, autoShutoffKey, {
		updates: {
			serverId,
			pauseUntilAt,
			scheduledShutdownAt: null,
			sequenceStage: "paused-manual",
			sequenceUpdatedAt: Date.now(),
			lastUpdatedAt: Date.now(),
		} satisfies AutoShutoffStateEntry,
	});

	return ResponseUtil.Success({ success: true, serverId, pauseUntilAt });
};
