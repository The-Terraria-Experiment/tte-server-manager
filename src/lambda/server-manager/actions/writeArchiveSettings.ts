import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { writeArchiveConfig } from "../shared/utils/jobs/ItemRuleScan.js";
import { normalizeArchive } from "../shared/utils/jobs/ItemRuleShape.js";
import type { ItemArchiveConfig } from "../shared/schema/SystemTable.js";

/**
 * Turns snapshot archiving on or off, and picks which captures are kept.
 *
 * A route of its own rather than a field on `PUT /server/{id}/items/rules`, even though both write
 * the same Dynamo row. The two are genuinely different jobs behind different permissions — deciding
 * what a server forbids, versus deciding what gets recorded — and folding this into the rules
 * endpoint would mean nobody could switch archiving on without also holding the right to rewrite the
 * enforcement list. Both writers use `UpdateItem` on disjoint attributes, so neither can reset the
 * other.
 */
export const writeArchiveSettings = async (
	event: AuthorizedEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	let archive: ItemArchiveConfig;
	try {
		archive = normalizeArchive(event.parsedBody);
	} catch (e: any) {
		return ResponseUtil.ValidationError(e?.message ?? "Invalid archive settings");
	}

	const userID = Parsers.GetUserSub(event) ?? "unknown";
	await writeArchiveConfig(serverID, archive, userID);

	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: userID,
		action: "write-archive-settings",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { serverID, ...archive },
	});

	return ResponseUtil.Success({ archive });
};
