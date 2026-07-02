import type { Context } from "aws-lambda";
import { randomUUID } from "node:crypto";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { ROLE_KEY_PREFIX, SYSTEM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

type WriteRoleBody = {
	roleId?: string;
	name?: string;
	permissions?: string[];
	color?: string;
};

export const writeRole = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as WriteRoleBody;
	if (!body.name) {
		return ResponseUtil.ValidationError("Missing required field: name");
	}

	const deduplicated = Array.from(new Set(body.permissions || []));
	const roleId = body.roleId || randomUUID();
	const uid = `${ROLE_KEY_PREFIX}${roleId}`;
	const color = body.color || "";
	const now = new Date().toISOString();

	const DB = new DynamoDao();
	let role;
	if (body.roleId) {
		role = await DB.UpdateItem(SYSTEM_TABLE, uid, {
			updates: {
				name: body.name,
				permissions: deduplicated,
				color,
				updatedAt: now,
			},
		});
	} else {
		await DB.PutItem(SYSTEM_TABLE, {
			uid,
			roleId,
			name: body.name,
			permissions: deduplicated,
			color,
			createdAt: now,
			updatedAt: now,
		});
		role = await DB.GetItem(SYSTEM_TABLE, uid);
	}

	await CWLogger.Action(FUNC_NAMES.SYS_MGR, {
		userId: Parsers.GetUserSub(event) ?? "unknown",
		action: "write-role",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { roleId, name: body.name, permissions: deduplicated, color },
	});

	return ResponseUtil.Success({
		roleId,
		name: (role?.name as string | undefined) ?? body.name,
		permissions: (role?.permissions as string[] | undefined) ?? deduplicated,
		color: (role?.color as string | undefined) ?? color,
	});
};
