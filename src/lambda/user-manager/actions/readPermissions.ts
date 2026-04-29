import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { PERM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

interface PermissionEntry {
	permissions?: string[];
	resourceAccess?: string[];
	uid?: string;
	username?: string;
	displayName?: string;
}

export const readPermissions = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const DB = new DynamoDao();
	const allEntries = (await DB.ScanTable(PERM_TABLE)) as PermissionEntry[];
	const filteredEntries = (allEntries || []).map((entry) => ({
		permissions: entry.permissions,
		resourceAccess: entry.resourceAccess,
		userID: entry.uid,
		username: entry.username,
		displayName: entry.displayName,
	}));

	await CWLogger.Action(FUNC_NAMES.USER_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-permissions",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
	});

	return ResponseUtil.Success({ entries: filteredEntries });
};
