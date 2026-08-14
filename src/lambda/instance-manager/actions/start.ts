import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import { Realtime } from "../shared/utils/realtime/RealtimePublisher.js";

const EC2 = new Ec2Dao();

export const start = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	// Starting a box that is mid-shutdown races the stop the worker is about to issue, and would
	// leave the instance in whichever state won.
	const blocked = await blockIfShutdownInProgress(instanceId);
	if (blocked) return blocked;

	await EC2.StartInstance(instanceId);

	const DB = new DynamoDao();
	await DB.UpdateItem(SYSTEM_TABLE, `autoshutoff#${instanceId}`, {
		updates: {
			serverId: instanceId,
			instanceStartedAt: Date.now(),
			lastUpdatedAt: Date.now(),
		},
	});

	// Announces that a start was *requested*, not that the box is running: nothing in AWS watches EC2
	// state transitions for us, so `pollInstanceState` in the UI is still what observes `running`. This
	// event is what flips other operators' tiles to a transitional state immediately.
	await Realtime.PublishInstanceState(instanceId, "pending");

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "start",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId },
	});

	return ResponseUtil.Success({ message: "Instance starting", instanceId });
};
