import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { CleanupUtil } from "../shared/utils/Cleanup.js";
import { syncAndPruneTShockLogs } from "../shared/utils/TShockConsoleLogs.js";
import { syncInstanceFilesToS3 } from "../shared/utils/InstanceFileSync.js";
import { shutdownSyncDeadline } from "../shared/utils/SyncBudget.js";

const EC2 = new Ec2Dao();

export const stop = async (event: AuthorizedEvent, context: Context) => {
	const instanceId = event.pathParameters?.id;
    if (!instanceId) {
        return ResponseUtil.ValidationError("Instance ID is required");
    }

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	// Both syncs share one budget drawn from this invocation's remaining time: they need the box
	// online, but must never eat the room needed to actually issue the stop below.
	const syncDeadline = shutdownSyncDeadline(context);
	await syncAndPruneTShockLogs(instanceId, syncDeadline);
	await syncInstanceFilesToS3(instanceId, syncDeadline);

	await EC2.StopInstance(instanceId);

	await CleanupUtil.ClearWorldCreationStatus(instanceId);

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "stop",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId },
	});

	return ResponseUtil.Success({ message: "Instance stopping", instanceId });
};
