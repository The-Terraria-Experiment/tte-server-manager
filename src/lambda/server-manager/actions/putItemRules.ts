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
import { normalizeEnforcement, normalizeEntries, normalizeGroups, normalizeMode } from "../shared/utils/jobs/ItemRuleShape.js";
import type { ItemEnforcementConfig, ItemRuleEntry, ItemRulesEntry } from "../shared/schema/SystemTable.js";

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
	let enforcement: ItemEnforcementConfig;
	try {
		mode = normalizeMode(body.mode);
		entries = normalizeEntries(body.entries ?? []);
		groups = normalizeGroups(body.groups);
		// Saved with the list rather than through an endpoint of its own: the consequence of breaking a
		// rule is part of the rule from the operator's side, and both are `rules.write`. That is the
		// opposite call from `archive`, which is switched independently of the ruleset and therefore has
		// its own permission and its own writer.
		enforcement = normalizeEnforcement(body.enforcement);
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
		enforcement,
		updatedBy: userID ?? "unknown",
		updatedAt: now,
		...(existing?.createdAt ? {} : { createdAt: now }),
	};

	const DB = new DynamoDao();
	// UpdateItem rather than PutItem, per the house rule for these mixed-record tables: a Put would
	// silently drop any attribute a future writer adds to this row but this handler doesn't send. That
	// is no longer hypothetical — `archive` lives on this row, is written by `writeArchiveConfig`
	// behind a different permission, and a Put here would switch snapshot archiving off every time
	// somebody saved a rule list.
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
			// Arming automated moderation is the part of this write that acts on players by itself, so it
			// is named in the audit line rather than left inside the payload.
			autoKick: Boolean(enforcement.kick),
		},
	});

	return ResponseUtil.Success({ rules: updates });
};
