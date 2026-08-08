import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { PATREON_TIERMAP_KEY_PREFIX, SYSTEM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import type { PatreonTierMapEntry } from "../shared/schema/SystemTable.js";

export const readPatreonTierMap = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const DB = new DynamoDao();
	const allEntries = (await DB.ScanTable(SYSTEM_TABLE)) as PatreonTierMapEntry[];
	const entries = (allEntries || [])
		.filter((entry) => entry.uid?.startsWith(PATREON_TIERMAP_KEY_PREFIX))
		.map((entry) => ({
			tierId: entry.tierId,
			tierName: entry.tierName || "",
			roleId: entry.roleId,
		}));

	await CWLogger.Action(FUNC_NAMES.SYS_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-patreon-tiermap",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
	});

	return ResponseUtil.Success({ entries });
};
