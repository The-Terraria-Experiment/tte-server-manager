import { DynamoDao } from "../../aws/DynamoDB.js";
import { ITEM_PRESET_KEY_PREFIX, ITEM_PRESET_RECORD_TYPE, RECORD_TYPE_INDEX, SYSTEM_TABLE } from "../../vars.js";
import type { ItemPresetEntry } from "../../schema/SystemTable.js";

/**
 * Row accessors for the site-wide item rule preset library (`preset#<presetId>`).
 *
 * A preset is a saved copy of a ruleset, not a link to one: loading it copies `mode`, `groups` and
 * `entries` into a server's own `itemrules#<id>` row through the existing rules endpoint. Nothing
 * here is on the scan path, and no server ever reads a preset row at enforcement time.
 */

/**
 * Bounds the library. This is a curated set of named rulesets an operator picks from a dropdown, so
 * the ceiling is about keeping that list usable more than about storage.
 */
export const MAX_PRESETS = 50;

/** Longest preset name, matching the cap on an entry's stored item name. */
export const MAX_PRESET_NAME = 120;

/** What the list endpoint returns: enough to choose from, without the entries. */
export type ItemPresetSummary = {
	presetId: string,
	name: string,
	mode: "whitelist" | "blacklist",
	groups: string[],
	itemCount: number,
	updatedAt: string | null,
	updatedBy: string | null,
};

export function itemPresetKey(presetId: string): string {
	return `${ITEM_PRESET_KEY_PREFIX}${presetId}`;
}

export async function readItemPresetRow(presetId: string): Promise<ItemPresetEntry | null> {
	const DB = new DynamoDao();
	return (await DB.GetItem(SYSTEM_TABLE, itemPresetKey(presetId))) as ItemPresetEntry | null;
}

/**
 * Every preset in this environment, as the summary attributes only.
 *
 * Read through `RECORD_TYPE_INDEX` rather than a prefix scan, which matters more here than it looks:
 * a scan's cost is the size of the whole table, and preset rows — up to 500 entries each — are by far
 * the largest things in it. Listing the library by scanning would read every entry of every preset to
 * render a dropdown of names. The index projects the summary attributes and pointedly **not**
 * `entries`, so this read stays proportional to the number of presets rather than their contents.
 * That is also why `itemCount` is stored rather than derived: `entries.length` is not available here.
 *
 * **Eventually consistent**, like any GSI read. Callers must not build read-after-write flows on it —
 * see `writeItemPreset`, which checks a preset's existence with a point read on the base table for
 * exactly this reason, and treats the collision and cap checks as advisory.
 */
export async function listItemPresets(): Promise<ItemPresetEntry[]> {
	const DB = new DynamoDao();
	const presets: ItemPresetEntry[] = [];
	let startKey: Record<string, unknown> | undefined = undefined;

	// Paged to completion: a truncated first page would read as a shorter library, which would let a
	// duplicate name through and mis-count against the cap.
	do {
		const page = await DB.Query(SYSTEM_TABLE, {
			indexName: RECORD_TYPE_INDEX,
			keyCondition: "#rt = :rt",
			expressionAttributeNames: { "#rt": "recordType" },
			expressionAttributeValues: { ":rt": ITEM_PRESET_RECORD_TYPE },
			...(startKey ? { exclusiveStartKey: startKey } : {}),
		});

		presets.push(...(page.items as ItemPresetEntry[]));
		startKey = page.lastKey ?? undefined;
	} while (startKey);

	return presets.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/**
 * The listable half of a preset. Takes `itemCount` from the stored attribute rather than `entries`,
 * because the index rows this runs against carry no `entries` at all.
 */
export function toPresetSummary(preset: ItemPresetEntry): ItemPresetSummary {
	return {
		presetId: preset.presetId ?? "",
		name: preset.name ?? "",
		mode: preset.mode ?? "blacklist",
		groups: preset.groups ?? [],
		itemCount: preset.itemCount ?? preset.entries?.length ?? 0,
		updatedAt: preset.updatedAt ?? null,
		updatedBy: preset.updatedBy ?? null,
	};
}

/**
 * Case-insensitive name collision, ignoring the row being renamed.
 *
 * Names are how an operator identifies a preset in a dropdown — two called "Vanilla" is precisely the
 * confusion the feature exists to remove, and there is no second visible field to tell them apart.
 */
export function findNameCollision(presets: ItemPresetEntry[], name: string, ignorePresetId?: string): ItemPresetEntry | null {
	const target = name.trim().toLowerCase();
	return presets.find(p => p.presetId !== ignorePresetId && (p.name ?? "").trim().toLowerCase() === target) ?? null;
}
