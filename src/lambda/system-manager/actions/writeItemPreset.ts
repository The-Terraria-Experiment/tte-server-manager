import type { Context } from "aws-lambda";
import { randomUUID } from "node:crypto";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { ITEM_PRESET_RECORD_TYPE, SYSTEM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import {
	MAX_PRESET_NAME,
	MAX_PRESETS,
	findNameCollision,
	itemPresetKey,
	listItemPresets,
	readItemPresetRow,
} from "../shared/utils/jobs/ItemPresets.js";
// The same normalizers the per-server rules endpoint uses. A preset that could hold an entry that
// endpoint rejects would save here and then fail on the SAVE the operator actually cares about.
import { normalizeEntries, normalizeGroups, normalizeMode } from "../shared/utils/jobs/ItemRuleShape.js";
import type { ItemRuleEntry } from "../shared/schema/SystemTable.js";

type WritePresetBody = {
	presetId?: string;
	name?: string;
	mode?: unknown;
	groups?: unknown;
	entries?: unknown;
};

/** Create (no `presetId`) or update (with one), matching the roles and tier-map writers. */
export const writeItemPreset = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as WritePresetBody;

	const name = String(body.name ?? "").trim().slice(0, MAX_PRESET_NAME);
	if (!name) {
		return ResponseUtil.ValidationError("Missing required field: name");
	}

	let mode: "whitelist" | "blacklist";
	let entries: ItemRuleEntry[];
	let groups: string[];
	try {
		mode = normalizeMode(body.mode);
		entries = normalizeEntries(body.entries ?? []);
		groups = normalizeGroups(body.groups);
	} catch (e: any) {
		return ResponseUtil.ValidationError(e?.message ?? "Invalid preset payload");
	}

	// An empty preset has nothing to load, and an empty list is never enforced in either mode — so
	// saving one would produce a library entry that silently does nothing when applied.
	if (!entries.length) {
		return ResponseUtil.ValidationError("A preset needs at least one item");
	}

	const isUpdate = Boolean(body.presetId);
	const presetId = body.presetId || randomUUID();
	const uid = itemPresetKey(presetId);

	// Existence is checked with a point read on the base table, never against the list below: that
	// list comes from a GSI and is eventually consistent, so a preset saved a moment ago can be absent
	// from it. Checking existence there would make "save as, then update" fail intermittently.
	if (isUpdate && !(await readItemPresetRow(presetId))) {
		return ResponseUtil.NotFoundError("Preset");
	}

	// The cap and the duplicate-name check are advisory for that same reason — a concurrent create can
	// slip past either. Both guard against confusion rather than enforcing an invariant, and nothing
	// downstream reads a preset by name, so losing the race costs a second preset with the same label.
	const existingPresets = await listItemPresets();

	if (!isUpdate && existingPresets.length >= MAX_PRESETS) {
		return ResponseUtil.Error(`No more than ${MAX_PRESETS} presets can be saved`, 409, "PRESET_LIMIT_REACHED");
	}

	const collision = findNameCollision(existingPresets, name, body.presetId);
	if (collision) {
		return ResponseUtil.Error(`A preset named “${name}” already exists`, 409, "PRESET_NAME_TAKEN");
	}

	const userID = Parsers.GetUserSub(event) ?? "unknown";
	const now = new Date().toISOString();

	const DB = new DynamoDao();
	if (isUpdate) {
		await DB.UpdateItem(SYSTEM_TABLE, uid, {
			updates: {
				// Rewritten on every update, not just on create: this is the sparse GSI's partition key,
				// and a row that stops carrying it leaves the index with no error anywhere.
				recordType: ITEM_PRESET_RECORD_TYPE,
				name,
				mode,
				groups,
				entries,
				// Denormalized so the library can be listed off the index, which doesn't project
				// `entries`. Written here and nowhere else, so it can't drift from what it counts.
				itemCount: entries.length,
				updatedBy: userID,
				updatedAt: now,
			},
		});
	} else {
		await DB.PutItem(SYSTEM_TABLE, {
			uid,
			recordType: ITEM_PRESET_RECORD_TYPE,
			presetId,
			name,
			mode,
			groups,
			entries,
			itemCount: entries.length,
			updatedBy: userID,
			createdAt: now,
			updatedAt: now,
		});
	}

	await CWLogger.Action(FUNC_NAMES.SYS_MGR, {
		userId: userID,
		action: "write-item-preset",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { presetId, name, mode, groups, entryCount: entries.length, created: !isUpdate },
	});

	return ResponseUtil.Success({
		preset: { presetId, name, mode, groups, entries, updatedBy: userID, updatedAt: now },
	});
};
