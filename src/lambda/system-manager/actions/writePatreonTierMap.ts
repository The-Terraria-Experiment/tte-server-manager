import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { PATREON_TIERMAP_KEY_PREFIX, SYSTEM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

type WritePatreonTierMapBody = {
	tierId?: string;
	tierName?: string;
	roleId?: string;
};

export const writePatreonTierMap = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as WritePatreonTierMapBody;
	if (!body.tierId) {
		return ResponseUtil.ValidationError("Missing required field: tierId");
	}
	if (!body.roleId) {
		return ResponseUtil.ValidationError("Missing required field: roleId");
	}

	const uid = `${PATREON_TIERMAP_KEY_PREFIX}${body.tierId}`;
	const tierName = body.tierName || "";
	const now = new Date().toISOString();

	const DB = new DynamoDao();
	const existing = await DB.GetItem(SYSTEM_TABLE, uid);

	if (existing) {
		await DB.UpdateItem(SYSTEM_TABLE, uid, {
			updates: {
				tierName,
				roleId: body.roleId,
				updatedAt: now,
			},
		});
	} else {
		await DB.PutItem(SYSTEM_TABLE, {
			uid,
			tierId: body.tierId,
			tierName,
			roleId: body.roleId,
			createdAt: now,
			updatedAt: now,
		});
	}

	await CWLogger.Action(FUNC_NAMES.SYS_MGR, {
		userId: Parsers.GetUserSub(event) ?? "unknown",
		action: "write-patreon-tiermap",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { tierId: body.tierId, tierName, roleId: body.roleId },
	});

	return ResponseUtil.Success({
		tierId: body.tierId,
		tierName,
		roleId: body.roleId,
	});
};
