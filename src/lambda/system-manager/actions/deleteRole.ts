import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { ROLE_KEY_PREFIX, SYSTEM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

type DeleteRoleBody = {
	roleId?: string;
};

export const deleteRole = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as DeleteRoleBody;
	if (!body.roleId) {
		return ResponseUtil.ValidationError("Missing required field: roleId");
	}

	const DB = new DynamoDao();
	await DB.DeleteItem(SYSTEM_TABLE, `${ROLE_KEY_PREFIX}${body.roleId}`);

	await CWLogger.Action(FUNC_NAMES.SYS_MGR, {
		userId: Parsers.GetUserSub(event) ?? "unknown",
		action: "delete-role",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { roleId: body.roleId },
	});

	return ResponseUtil.Success({ roleId: body.roleId });
};
