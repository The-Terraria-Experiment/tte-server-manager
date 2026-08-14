import { SNAPSHOT_GROUPS } from "../tshock/InventorySnapshots.js";
import type { SnapshotKind } from "../tshock/InventorySnapshots.js";
import type { ItemArchiveConfig, ItemEnforcementConfig, ItemRuleEntry } from "../../schema/SystemTable.js";

/**
 * Validation for the shape an item ruleset takes on the wire.
 *
 * Two writers submit this shape: `PUT /server/{id}/items/rules` (the list a specific server enforces)
 * and `POST /system/items/presets` (a saved copy of one, reusable across servers). They have to agree
 * exactly — a preset that can hold an entry the rules endpoint rejects is a preset that saves fine and
 * then fails on the SAVE the operator actually cares about, naming a limit they never saw. Hence one
 * module rather than a copy in each action.
 *
 * These are runtime values, so they live inside `_shared/shared` rather than `src/shared/types`:
 * `build.js` copies this tree into each function, and a value import reaching outside it typechecks,
 * builds, and then dies with ERR_MODULE_NOT_FOUND on the first call.
 *
 * The normalizers throw plain `Error`s with user-facing messages; callers convert them with
 * `ResponseUtil.ValidationError`.
 */

/** Well past any realistic list, and low enough that the row stays comfortably inside Dynamo's item limit. */
export const MAX_ENTRIES = 500;

export const MODES = new Set(["whitelist", "blacklist"]);

/**
 * Terraria's negative net ids are real — they address the legacy/alternate variants of items, and the
 * plugin reports them verbatim — so the list must be able to name one. Only 0 is excluded, since that
 * is the id of "no item". The outer bounds are a sanity check, not a claim about the id space.
 */
export const MIN_NET_ID = -100;
export const MAX_NET_ID = 100000;

/** Longest stored copy of an item's display name, and of a per-entry note. */
export const MAX_ENTRY_NAME = 120;
export const MAX_ENTRY_NOTE = 200;

/**
 * Normalizes the submitted entry list: integer ids only, deduplicated, capped.
 *
 * De-duplication matters more than it looks. The same id listed twice is harmless to the evaluator
 * (it builds a Set), but it renders as two identical rows in the editor, and removing "one of them"
 * then appears to do nothing.
 */
export const normalizeEntries = (raw: unknown): ItemRuleEntry[] => {
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
			...(entry?.name ? { name: String(entry.name).slice(0, MAX_ENTRY_NAME) } : {}),
			...(entry?.note ? { note: String(entry.note).slice(0, MAX_ENTRY_NOTE) } : {}),
		});
	}

	return [...seen.values()];
};

export const normalizeGroups = (raw: unknown): string[] => {
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

/**
 * Defaults to blacklist, matching the editor's own default. Whitelist is the mode that flags most of
 * what a normal player carries, so it is never the one an omitted field should select.
 */
export const normalizeMode = (raw: unknown): "whitelist" | "blacklist" => {
	const mode = String(raw ?? "blacklist");
	if (!MODES.has(mode)) {
		throw new Error("Mode must be 'whitelist' or 'blacklist'");
	}
	return mode as "whitelist" | "blacklist";
};

/**
 * Shown to a player auto-kicked for a rule violation, when the operator has not written their own.
 *
 * Deliberately says what happened and what to do about it: a kick with no explanation is
 * indistinguishable from the server being broken, and the player is the only one who can fix it.
 */
export const DEFAULT_KICK_REASON = "Your inventory contains items that are not allowed on this server.";

/** Longest custom kick message. TShock passes this straight to the client's disconnect screen. */
export const MAX_KICK_REASON = 200;

/**
 * Normalizes the automated-enforcement settings.
 *
 * Not part of a preset, like `enabled` and `archive`: a preset is a list of items, and arming the
 * automated response to that list is an operational decision about one box. Loading a saved ruleset
 * must never start kicking people underneath a running server.
 */
export const normalizeEnforcement = (raw: unknown): ItemEnforcementConfig => {
	if (raw === undefined || raw === null) {
		return { kick: false, kickReason: DEFAULT_KICK_REASON };
	}
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Enforcement settings must be an object");
	}

	const config = raw as Record<string, unknown>;
	const reason = String(config.kickReason ?? "").trim().slice(0, MAX_KICK_REASON);

	return {
		kick: Boolean(config.kick),
		// An empty message is normalized to the default rather than stored, so a player never gets a
		// kick screen with nothing on it because someone cleared the box.
		kickReason: reason || DEFAULT_KICK_REASON,
	};
};

export const ARCHIVE_KINDS = new Set<SnapshotKind>(["join", "leave"]);

/**
 * Normalizes the snapshot-archive settings.
 *
 * Deliberately *not* part of a preset. A preset is a ruleset — what a server should forbid — and this
 * is an operational switch on one box's storage, exactly like `enabled`. Loading a saved list must
 * not start or stop archiving underneath a running server.
 */
export const normalizeArchive = (raw: unknown): ItemArchiveConfig => {
	if (raw === undefined || raw === null) {
		return { enabled: false, kinds: ["join"] };
	}
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Archive settings must be an object");
	}

	const config = raw as Record<string, unknown>;
	const rawKinds = config.kinds;

	if (rawKinds !== undefined && !Array.isArray(rawKinds)) {
		throw new Error("Archive kinds must be an array");
	}

	const kinds = [...new Set((rawKinds ?? ["join"]).map(String))].filter(
		(kind): kind is SnapshotKind => ARCHIVE_KINDS.has(kind as SnapshotKind),
	);

	if (!kinds.length) {
		throw new Error("At least one capture kind is required (join, leave)");
	}

	return { enabled: Boolean(config.enabled), kinds };
};
