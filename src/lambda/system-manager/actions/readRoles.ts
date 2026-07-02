import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { ROLE_KEY_PREFIX, SYSTEM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import type { RoleEntry } from "../shared/schema/SystemTable.js";

export const readRoles = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const DB = new DynamoDao();
	const allEntries = (await DB.ScanTable(SYSTEM_TABLE)) as RoleEntry[];
	const roles = (allEntries || [])
		.filter((entry) => entry.uid?.startsWith(ROLE_KEY_PREFIX))
		.map((entry) => ({
			roleId: entry.roleId,
			name: entry.name,
			permissions: entry.permissions || [],
			color: entry.color || "",
		}));

	await CWLogger.Action(FUNC_NAMES.SYS_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-roles",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
	});

	return ResponseUtil.Success({ entries: roles });
};
