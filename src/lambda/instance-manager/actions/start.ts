import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { SYSTEM_TABLE } from "../shared/vars.js";

const EC2 = new Ec2Dao();

export const start = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);
	await EC2.StartInstance(instanceId);

	const DB = new DynamoDao();
	await DB.UpdateItem(SYSTEM_TABLE, `autoshutoff#${instanceId}`, {
		updates: {
			serverId: instanceId,
			instanceStartedAt: Date.now(),
			lastUpdatedAt: Date.now(),
		},
	});

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "start",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId },
	});

	return ResponseUtil.Success({ message: "Instance starting", instanceId });
};
