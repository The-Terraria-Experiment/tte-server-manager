import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { CleanupUtil } from "../shared/utils/jobs/Cleanup.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import { Realtime } from "../shared/utils/realtime/RealtimePublisher.js";

const EC2 = new Ec2Dao();

export const restart = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
    if (!instanceId) {
        return ResponseUtil.ValidationError("Instance ID is required");
    }

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const blocked = await blockIfShutdownInProgress(instanceId);
	if (blocked) return blocked;

	await EC2.RebootInstance(instanceId);

	await CleanupUtil.ClearWorldCreationStatus(instanceId);

	// Both tiles are now wrong for everyone else, but they are wrong in different ways: the instance is
	// coming back, the game server is not. A reboot kills the TShock process with the box and nothing
	// relaunches it, so the server stays down until someone launches a world — hence "stopped" rather
	// than "rebooting" here. (It is also an ungraceful kill, so the world is only as current as its last
	// autosave; the graceful path is the REST stop in the shutdown job.)
	await Realtime.PublishInstanceState(instanceId, "rebooting");
	await Realtime.PublishServerState(instanceId, "stopped");

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "restart",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId },
	});

	return ResponseUtil.Success({ message: "Instance rebooting", instanceId });
};
