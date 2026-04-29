import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { PERM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

type SetUsernameBody = {
	username?: string;
};

export const setUsername = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as SetUsernameBody;
	if (!body.username) {
		return ResponseUtil.ValidationError("Missing required field: username");
	}

	const userSub = Parsers.GetUserSub(event);
	if (!userSub) {
		return ResponseUtil.PermissionDeniedError("Unauthorized: No user context");
	}

	const DB = new DynamoDao();
	const updated = await DB.UpdateItem(PERM_TABLE, `user#${userSub}`, {
		updates: {
			displayName: body.username,
		},
	});

	await CWLogger.Action(FUNC_NAMES.USER_MGR, {
		userId: userSub,
		action: "set-username",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { newDisplayName: updated?.displayName },
	});

	return ResponseUtil.Success({
		displayName: (updated?.displayName as string | undefined) || body.username,
		userID: userSub,
	});
};
