import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";

const DB = new DynamoDao();

export const readFileRoots = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.NotFoundError("Instance ID");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const instanceData = await DB.GetItem(process.env.INSTANCE_TABLE_NAME as string, `inst#${instanceId}`);
	const pathRoots = instanceData?.validRoots || [];
	const worldPaths = instanceData?.worldPaths || [];

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-filepaths",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { pathRoots, worldPaths },
	});

	return ResponseUtil.Success({ pathRoots, worldPaths });
};
