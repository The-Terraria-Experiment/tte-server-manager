import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { readShutdownState } from "../shared/utils/jobs/ShutdownJob.js";

const EC2 = new Ec2Dao();

export const getStatus = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
    if (!instanceId) {
        return ResponseUtil.ValidationError("Instance ID is required");
    }

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);
	const status = await EC2.GetInstanceStatus(instanceId);

	// Hung off the instance payload rather than served from its own endpoint: a shutdown now runs for
	// minutes while the user is free to navigate, and every page that can mutate this instance
	// already fetches this. Riding along is what makes the state survive refresh and route changes
	// with no reattach logic, and what lets each page disable its own controls.
	const shutdown = await readShutdownState(instanceId);

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "get-status",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { status },
	});

	// privateIp is destructured off rather than spread through: it's only ever an input to the
	// TShock REST path, the client has no use for it, and this response goes to the browser.
	const { privateIp: _privateIp, ...clientStatus } = status;

	return ResponseUtil.Success({ instance: { ...clientStatus, shutdown } });
};
