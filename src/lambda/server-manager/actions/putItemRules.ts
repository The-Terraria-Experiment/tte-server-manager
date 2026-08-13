import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { itemRulesKey, readItemRules } from "../shared/utils/jobs/ItemRuleScan.js";
// Shared with the preset writer in `system-manager` so the two can't drift — see ItemRuleShape.ts.
import { normalizeEntries, normalizeGroups, normalizeMode } from "../shared/utils/jobs/ItemRuleShape.js";
import type { ItemRuleEntry, ItemRulesEntry } from "../shared/schema/SystemTable.js";

export const putItemRules = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	const body = event.parsedBody as Record<string, any> | undefined;
	if (!body) {
		return ResponseUtil.ValidationError("A rules payload is required");
	}

	let mode: "whitelist" | "blacklist";
	let entries: ItemRuleEntry[];
	let groups: string[];
	try {
		mode = normalizeMode(body.mode);
		entries = normalizeEntries(body.entries ?? []);
		groups = normalizeGroups(body.groups);
	} catch (e: any) {
		return ResponseUtil.ValidationError(e?.message ?? "Invalid rules payload");
	}

	const userID = Parsers.GetUserSub(event);
	const now = new Date().toISOString();
	const existing = await readItemRules(serverID);

	const updates: ItemRulesEntry = {
		instanceID: serverID,
		mode,
		enabled: Boolean(body.enabled),
		groups,
		entries,
		updatedBy: userID ?? "unknown",
		updatedAt: now,
		...(existing?.createdAt ? {} : { createdAt: now }),
	};

	const DB = new DynamoDao();
	// UpdateItem rather than PutItem, per the house rule for these mixed-record tables: a Put would
	// silently drop any attribute a future writer adds to this row but this handler doesn't send.
	await DB.UpdateItem(SYSTEM_TABLE, itemRulesKey(serverID), { updates });

	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: userID,
		action: "write-item-rules",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: {
			serverID,
			mode,
			enabled: updates.enabled,
			groups,
			entryCount: entries.length,
		},
	});

	return ResponseUtil.Success({ rules: updates });
};
