import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { PERM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Permissions.js";

type WriteResourcePermissionsBody = {
	resourceAccess?: string[];
	userID?: string;
};

export const writeResourcePermissions = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as WriteResourcePermissionsBody;
	if (!body.resourceAccess || !body.userID) {
		return ResponseUtil.ValidationError("Missing required fields: resourceAccess and userID");
	}

	const deduplicated = Array.from(new Set(body.resourceAccess || []));
	const DB = new DynamoDao();
	const updated = await DB.UpdateItem(PERM_TABLE, body.userID, {
		updates: {
			resourceAccess: deduplicated,
		},
	});
	const cacheVersion = await Permissions.BumpPermissionCacheVersion();

	await CWLogger.Action(FUNC_NAMES.USER_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "write-resource-permissions",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: {
			updatedUser: body.userID,
			permissions: deduplicated,
		},
	});

	return ResponseUtil.Success({
		permissions: (updated?.resourceAccess as string[] | undefined) || [],
		updateUser: body.userID,
		cacheVersion,
	});
};
