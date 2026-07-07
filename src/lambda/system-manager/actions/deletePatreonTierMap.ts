import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { PATREON_TIERMAP_KEY_PREFIX, SYSTEM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

type DeletePatreonTierMapBody = {
	tierId?: string;
};

export const deletePatreonTierMap = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as DeletePatreonTierMapBody;
	if (!body.tierId) {
		return ResponseUtil.ValidationError("Missing required field: tierId");
	}

	const DB = new DynamoDao();
	await DB.DeleteItem(SYSTEM_TABLE, `${PATREON_TIERMAP_KEY_PREFIX}${body.tierId}`);

	await CWLogger.Action(FUNC_NAMES.SYS_MGR, {
		userId: Parsers.GetUserSub(event) ?? "unknown",
		action: "delete-patreon-tiermap",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { tierId: body.tierId },
	});

	return ResponseUtil.Success({ tierId: body.tierId });
};
