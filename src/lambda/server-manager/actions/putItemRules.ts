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
import { SNAPSHOT_GROUPS } from "../shared/utils/tshock/InventorySnapshots.js";
import type { ItemRuleEntry, ItemRulesEntry } from "../shared/schema/SystemTable.js";

/** Well past any realistic list, and low enough that the row stays comfortably inside Dynamo's item limit. */
const MAX_ENTRIES = 500;

const MODES = new Set(["whitelist", "blacklist"]);

/**
 * Terraria's negative net ids are real — they address the legacy/alternate variants of items, and the
 * plugin reports them verbatim — so the list must be able to name one. Only 0 is excluded, since that
 * is the id of "no item". The outer bounds are a sanity check, not a claim about the id space.
 */
const MIN_NET_ID = -100;
const MAX_NET_ID = 100000;

/**
 * Normalizes the submitted entry list: integer ids only, deduplicated, capped.
 *
 * De-duplication matters more than it looks. The same id listed twice is harmless to the evaluator
 * (it builds a Set), but it renders as two identical rows in the editor, and removing "one of them"
 * then appears to do nothing.
 */
const normalizeEntries = (raw: unknown): ItemRuleEntry[] => {
	if (!Array.isArray(raw)) {
		throw new Error("Entries must be an array");
	}
	if (raw.length > MAX_ENTRIES) {
		throw new Error(`No more than ${MAX_ENTRIES} entries are allowed`);
	}

	const seen = new Map<number, ItemRuleEntry>();

	for (const entry of raw) {
		const netId = Number(entry?.netId);
		if (!Number.isInteger(netId) || netId === 0 || netId < MIN_NET_ID || netId > MAX_NET_ID) {
			throw new Error(`Invalid item id: ${entry?.netId}`);
		}

		seen.set(netId, {
			netId,
			...(entry?.name ? { name: String(entry.name).slice(0, 120) } : {}),
			...(entry?.note ? { note: String(entry.note).slice(0, 200) } : {}),
		});
	}

	return [...seen.values()];
};

const normalizeGroups = (raw: unknown): string[] => {
	if (raw === undefined || raw === null) {
		return [...SNAPSHOT_GROUPS];
	}
	if (!Array.isArray(raw)) {
		throw new Error("Groups must be an array");
	}

	const groups = raw.map(String).filter(group => (SNAPSHOT_GROUPS as readonly string[]).includes(group));
	if (!groups.length) {
		throw new Error(`At least one container group is required (${SNAPSHOT_GROUPS.join(", ")})`);
	}

	return [...new Set(groups)];
};

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

	const mode = String(body.mode ?? "blacklist");
	if (!MODES.has(mode)) {
		return ResponseUtil.ValidationError("Mode must be 'whitelist' or 'blacklist'");
	}

	let entries: ItemRuleEntry[];
	let groups: string[];
	try {
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
		mode: mode as "whitelist" | "blacklist",
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
