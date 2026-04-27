import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { PERM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/permissions.js";

type WritePermissionsBody = {
	permissions?: string[];
	userID?: string;
};

export const writePermissions = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as WritePermissionsBody;
	if (!body.permissions || !body.userID) {
		return ResponseUtil.ValidationError("Missing required fields: permissions and userID");
	}

	const deduplicated = Array.from(new Set(body.permissions || []));
	const DB = new DynamoDao();
	const updated = await DB.UpdateItem(PERM_TABLE, body.userID, {
		updates: {
			permissions: deduplicated,
		},
	});
	const cacheVersion = await Permissions.BumpPermissionCacheVersion();

	await CWLogger.Action(FUNC_NAMES.USER_MGR, {
		userId: Parsers.GetUserSub(event) ?? "unknown",
		action: "write-permissions",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: {
			updatedUser: body.userID,
			permissions: deduplicated,
		},
	});

	return ResponseUtil.Success({
		permissions: (updated?.permissions as string[] | undefined) || [],
		updateUser: body.userID,
		cacheVersion,
	});
};
