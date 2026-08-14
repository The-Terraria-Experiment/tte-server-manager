import { DynamoDao } from "../../aws/DynamoDB.js";
import { INVENTORY_SCAN_KEY, ITEM_RULES_KEY, SYSTEM_TABLE } from "../../vars.js";
import type { SnapshotKind } from "../tshock/InventorySnapshots.js";
import type { InventoryScanEntry, ItemArchiveConfig, ItemRulesEntry, PlayerViolation } from "../../schema/SystemTable.js";

/**
 * Row accessors and concurrency control for the inventory-snapshot scan.
 *
 * Two rows per instance in the (per-environment) system table:
 *   `itemrules#<id>` — the operator's list. Read on every roster event, written from the UI.
 *   `invscan#<id>`   — where the cursor is, who is draining, and the latest violation per player.
 *
 * The lease is the interesting part. A ten-player join burst produces ten `pushLog` calls and
 * therefore ten worker invocations, all of which would otherwise drain the same cursor concurrently:
 * ten TShock round trips against a box that is sometimes single-core, and ten writers racing to
 * advance one cursor. So exactly one wins the lease and drains; the losers set `pending` and return,
 * and the holder re-drains before releasing. That is the same shape as `realtimeStore.flush`'s
 * dirty-flag re-arm, and it means the losers' snapshots are still scanned — by the one drain that is
 * already running, which is the whole point.
 */

/**
 * Wakes the inventory-snapshot drain in `server-manager`. Sent by `logs-manager` on every join/leave
 * and by the Scan now button, so it lives here rather than in either function's `index.ts` — a
 * *value* import across that boundary resolves at source level and then fails at runtime, and the
 * type alone should not require reaching into another lambda's entry point.
 *
 * Carries no snapshot data. The worker drains the plugin's cursor itself, which is what keeps a
 * ten-player join burst at one drain instead of ten.
 */
export type InventoryScanRequestData = {
	requestType: typeof INVENTORY_SCAN_REQUEST_TYPE,
	instanceID: string,
	/** Cognito sub for a manual scan, or "[log-event]" when a roster event triggered it. */
	requestedBy: string,
	reason: "player-event" | "manual",
};

export const INVENTORY_SCAN_REQUEST_TYPE = "inventory-scan-request";

/**
 * Lease duration. Must comfortably exceed a full drain (initial delay + budget × re-drain passes),
 * because an expired lease lets a second worker start on top of the first. It is also the recovery
 * window: a worker killed mid-drain leaves the lease behind, and nothing else can scan until it
 * lapses. The cursor is only advanced on a successful write, so that recovery costs a delay, never
 * data — the next drain re-reads from where the dead one started.
 *
 * Raised from 90s when snapshot archiving was added: a pass is now the join-capture delay, the drain
 * budget *and* an archive budget, which put the three-pass worst case around 80s — close enough to
 * the old ceiling that a slow S3 could have made a live job look abandoned. `server-manager` runs at
 * 900s, so the function timeout is not the constraint here. Change this and the per-pass budgets in
 * `scanInventorySnapshots` together; that is the invariant, not either number on its own.
 */
export const SCAN_LEASE_MS = 150 * 1000;

/** Most players tracked in one `violations` map, oldest dropped first. Bounds the row's size. */
export const PLAYER_VIOLATION_CAP = 50;

/**
 * Most offending items recorded per violation. Whitelist mode against a player carrying nothing on
 * the list flags every slot they have, which is ~350 entries of no additional diagnostic value.
 */
export const VIOLATION_ITEM_CAP = 50;

export function itemRulesKey(instanceId: string): string {
	return `${ITEM_RULES_KEY}#${instanceId}`;
}

export function inventoryScanKey(instanceId: string): string {
	return `${INVENTORY_SCAN_KEY}#${instanceId}`;
}

export async function readItemRules(instanceId: string): Promise<ItemRulesEntry | null> {
	const DB = new DynamoDao();
	return (await DB.GetItem(SYSTEM_TABLE, itemRulesKey(instanceId))) as ItemRulesEntry | null;
}

export async function readScanState(instanceId: string): Promise<InventoryScanEntry | null> {
	const DB = new DynamoDao();
	return (await DB.GetItem(SYSTEM_TABLE, inventoryScanKey(instanceId))) as InventoryScanEntry | null;
}

/**
 * True when the rules are switched on *and* have something in them.
 *
 * The empty-list case is excluded for both modes, and for whitelist it matters: an empty whitelist
 * means "nothing is permitted", so every item every player carries would be flagged the moment the
 * switch was flipped, before anyone had added a single entry. Treating empty as unconfigured makes
 * the enable-then-populate order safe, which is the order anyone will actually use.
 */
export function hasActiveRules(rules: ItemRulesEntry | null): boolean {
	return Boolean(rules?.enabled && rules.entries?.length);
}

/**
 * Whether the plugin's cursor should be drained at all.
 *
 * This is a different question from {@link hasActiveRules}, and keeping the two apart is the whole
 * shape of the archive feature: archiving is an independent switch, so an instance with no rule list
 * whatsoever still drains and still stores every capture — it simply reaches no conclusion about
 * anybody. `hasActiveRules` gates *evaluation*; this gates *draining*. Every caller that used to ask
 * the first question before waking the worker asks this one instead.
 */
export function isScanActive(rules: ItemRulesEntry | null): boolean {
	return hasActiveRules(rules) || Boolean(rules?.archive?.enabled);
}

/** Whether captures are being persisted, independent of whether anything is being judged. */
export function isArchiveActive(rules: ItemRulesEntry | null): boolean {
	return Boolean(rules?.archive?.enabled);
}

/**
 * Which capture kinds get archived. Defaults to joins only — that is what the rules ask about, and
 * it is the cheaper half of the traffic.
 */
export function archiveKinds(rules: ItemRulesEntry | null): SnapshotKind[] {
	const configured = (rules?.archive?.kinds ?? []).filter(
		(kind): kind is SnapshotKind => kind === "join" || kind === "leave",
	);
	return configured.length ? configured : ["join"];
}

/**
 * Writes only the `archive` attribute.
 *
 * An `UpdateItem` rather than a row write, because `putItemRules` owns the rest of this row and the
 * two are edited from different places by users who may hold different permissions. Either writer
 * replacing the whole item would silently reset the other's setting — the same trap as the instance
 * registry's `PutItem`-vs-`UpdateItem` split.
 */
export async function writeArchiveConfig(
	instanceId: string,
	archive: ItemArchiveConfig,
	updatedBy: string,
): Promise<void> {
	const DB = new DynamoDao();
	await DB.UpdateItem(SYSTEM_TABLE, itemRulesKey(instanceId), {
		UpdateExpression: "SET #instanceID = :instance, #archive = :archive, #updatedBy = :updatedBy, #updatedAt = :updatedAt",
		ExpressionAttributeNames: {
			"#instanceID": "instanceID",
			"#archive": "archive",
			"#updatedBy": "updatedBy",
			"#updatedAt": "updatedAt",
		},
		ExpressionAttributeValues: {
			":instance": instanceId,
			":archive": archive,
			":updatedBy": updatedBy,
			":updatedAt": new Date().toISOString(),
		},
	});
}

/**
 * Takes the drain lease, or reports that someone else holds it.
 *
 * Note `DynamoDao.UpdateItem` swallows its errors and returns `null`, so a lost race and a genuine
 * Dynamo failure are indistinguishable here. That conflation is deliberate rather than tolerated:
 * both mean "do not drain right now", the DAO logs the real error itself, and the next roster event
 * retries the whole thing anyway.
 */
export async function claimScanLease(instanceId: string, owner: string): Promise<boolean> {
	const DB = new DynamoDao();
	const now = Date.now();

	const result = await DB.UpdateItem(SYSTEM_TABLE, inventoryScanKey(instanceId), {
		// `violations` is seeded here rather than left to the first write that has something to put in
		// it, because `writeScanResult` addresses it by nested path (`violations.<player>`) and Dynamo
		// rejects a path whose parent map does not exist. Doing it at claim time means every drain runs
		// against a row where those paths are already valid, at no extra write.
		UpdateExpression:
			"SET #lease = :until, #owner = :owner, #instance = :instance, #pending = :pending, #violations = if_not_exists(#violations, :emptyViolations)",
		ExpressionAttributeNames: {
			"#lease": "leaseUntil",
			"#owner": "leaseOwner",
			"#instance": "instanceID",
			"#pending": "pending",
			"#violations": "violations",
		},
		ExpressionAttributeValues: {
			":until": now + SCAN_LEASE_MS,
			":owner": owner,
			":instance": instanceId,
			":pending": false,
			":now": now,
			":emptyViolations": {},
		},
		ConditionExpression: "attribute_not_exists(leaseUntil) OR leaseUntil < :now",
	});

	return Boolean(result);
}

/** Records that a scan was requested while the lease was held, so the holder drains once more. */
export async function markScanPending(instanceId: string): Promise<void> {
	const DB = new DynamoDao();
	await DB.UpdateItem(SYSTEM_TABLE, inventoryScanKey(instanceId), {
		updates: { pending: true, instanceID: instanceId },
	});
}

/**
 * Clears the flag *before* a pass, never after.
 *
 * Clearing afterwards would discard a request that arrived while that pass was running — the request
 * whose snapshot the pass may well have started too early to see. Cleared first, any such arrival
 * re-sets the flag and earns its own pass.
 */
export async function clearScanPending(instanceId: string): Promise<void> {
	const DB = new DynamoDao();
	await DB.UpdateItem(SYSTEM_TABLE, inventoryScanKey(instanceId), {
		updates: { pending: false, instanceID: instanceId },
	});
}

/** Reads the pending flag without disturbing the lease. */
export async function isScanPending(instanceId: string): Promise<boolean> {
	const state = await readScanState(instanceId);
	return Boolean(state?.pending);
}

/**
 * Writes the drain's outcome and drops the lease in one update.
 *
 * Releasing here rather than in a separate call is what keeps the cursor and the lease consistent: a
 * crash between the two would either strand the lease (blocking scans for its full duration) or free
 * it before the cursor was written (letting the next worker re-drain everything).
 *
 * **Violations are written per player, never as a whole map, and that is what makes dismissing one
 * safe.** A drain reads the violation set at its start and finishes up to a lease-length later; if it
 * wrote the map it had read, an operator who dismissed a flag in between would watch it come back
 * with nothing to explain it. Addressing `violations.<player>` individually means this update touches
 * only the players this drain actually reached a conclusion about, and a dismissal of anyone else
 * survives it. Where the two genuinely collide — a dismissed player rejoined and was flagged again
 * during the same drain — the drain wins, which is correct: that is new evidence, not stale evidence.
 */
export async function writeScanResult(
	instanceId: string,
	result: {
		cursor: number,
		head: number,
		/** Players this drain flagged. Written individually; players absent here are left alone. */
		upserts: Record<string, PlayerViolation>,
		/** Players this drain cleared — a clean re-join, or pruned for age. */
		removals: string[],
		status: string,
	},
): Promise<void> {
	const DB = new DynamoDao();

	const names: Record<string, string> = {};
	const values: Record<string, unknown> = {
		":instance": instanceId,
		":cursor": result.cursor,
		":head": result.head,
		":lastScanAt": Date.now(),
		":lastScanStatus": result.status,
		":leaseUntil": 0,
		":pending": false,
		":updatedAt": new Date().toISOString(),
	};

	const sets = [
		"#instanceID = :instance",
		"#cursor = :cursor",
		"#head = :head",
		"#lastScanAt = :lastScanAt",
		"#lastScanStatus = :lastScanStatus",
		"#leaseUntil = :leaseUntil",
		"#pending = :pending",
		"#updatedAt = :updatedAt",
	];

	// Reserved words and dotted paths both need aliasing, so every attribute goes through #names.
	Object.assign(names, {
		"#instanceID": "instanceID",
		"#cursor": "cursor",
		"#head": "head",
		"#lastScanAt": "lastScanAt",
		"#lastScanStatus": "lastScanStatus",
		"#leaseUntil": "leaseUntil",
		"#pending": "pending",
		"#updatedAt": "updatedAt",
	});

	// Declared only when something actually references it. Dynamo rejects the whole update if
	// ExpressionAttributeNames carries an entry no expression uses, and the commonest drain of all —
	// one that saw only leave captures, or no captures — concludes nothing about any player.
	const upsertEntries = Object.entries(result.upserts);
	if (upsertEntries.length || result.removals.length) {
		names["#violations"] = "violations";
	}

	// Player names are user-controlled, so they can never go into the expression text itself — each
	// becomes a positional alias instead.
	upsertEntries.forEach(([player, violation], index) => {
		names[`#up${index}`] = player;
		values[`:up${index}`] = violation;
		sets.push(`#violations.#up${index} = :up${index}`);
	});

	const removes: string[] = [];
	result.removals.forEach((player, index) => {
		names[`#rm${index}`] = player;
		removes.push(`#violations.#rm${index}`);
	});

	const expression = `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`;

	await DB.UpdateItem(SYSTEM_TABLE, inventoryScanKey(instanceId), {
		UpdateExpression: expression,
		ExpressionAttributeNames: names,
		ExpressionAttributeValues: values,
	});
}

/**
 * Drops the lease without touching the cursor or the violations. For the failure path — the drain
 * achieved nothing, so recording its cursor would skip past snapshots it never read.
 */
export async function releaseScanLease(instanceId: string, status: string): Promise<void> {
	const DB = new DynamoDao();
	await DB.UpdateItem(SYSTEM_TABLE, inventoryScanKey(instanceId), {
		updates: {
			instanceID: instanceId,
			leaseUntil: 0,
			lastScanStatus: status,
			updatedAt: new Date().toISOString(),
		},
	});
}

/**
 * Clears the flags for specific players, and reports which ones were actually there.
 *
 * Dismissal exists because nothing else clears a flag except the same player joining again clean.
 * That is deliberate — a flag that lapsed when its owner disconnected could be erased by the offender
 * simply leaving — but it leaves an operator who has dealt with someone no way to say so. This is it.
 *
 * Always takes an explicit player list, even for "dismiss everything": resolving that to the names
 * the operator was actually looking at, and removing those individually, means a violation raised
 * between the read and this write survives instead of being wiped by a blanket overwrite. Same
 * reasoning as the per-player writes in `writeScanResult`, from the other side.
 *
 * The removed list is what lets the caller publish only on a real change, so dismissing an already
 * dismissed player is silent rather than a refetch in every open browser.
 */
export async function dismissViolations(instanceId: string, players: string[]): Promise<string[]> {
	if (!players.length) {
		return [];
	}

	const DB = new DynamoDao();
	const names: Record<string, string> = { "#violations": "violations" };
	const paths: string[] = [];

	// Player names come from the request body, so they are aliased rather than interpolated.
	players.forEach((player, index) => {
		names[`#p${index}`] = player;
		paths.push(`#violations.#p${index}`);
	});

	const result = await DB.UpdateItem(SYSTEM_TABLE, inventoryScanKey(instanceId), {
		UpdateExpression: `SET #updatedAt = :updatedAt REMOVE ${paths.join(", ")}`,
		ExpressionAttributeNames: { ...names, "#updatedAt": "updatedAt" },
		ExpressionAttributeValues: { ":updatedAt": new Date().toISOString() },
		// ALL_OLD so the caller learns which of these were genuinely flagged. A REMOVE of an absent
		// path is a silent no-op, so without this there is no way to tell a real dismissal from one
		// that did nothing.
		ReturnValues: "ALL_OLD",
	});

	const before = (result?.violations ?? {}) as Record<string, PlayerViolation>;
	return players.filter(player => Boolean(before[player]));
}

/** Keeps the most recently flagged players and drops the rest, so the row can't grow without bound. */
export function pruneViolations(violations: Record<string, PlayerViolation>): Record<string, PlayerViolation> {
	const entries = Object.entries(violations);
	if (entries.length <= PLAYER_VIOLATION_CAP) {
		return violations;
	}

	entries.sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0));
	return Object.fromEntries(entries.slice(0, PLAYER_VIOLATION_CAP));
}

/**
 * Whether anything a browser would render actually moved.
 *
 * Every single join runs a scan, so publishing unconditionally would mean a status refetch in every
 * open browser per join — the exact per-activity cost `updateAutoShutoffState` avoids by diffing
 * against `ALL_OLD`. Compared on the player set and the snapshot each flag came from, so a re-scan
 * that reaches the same conclusion is silent while a new offence is not.
 */
export function violationsChanged(
	before: Record<string, PlayerViolation> | undefined,
	after: Record<string, PlayerViolation>,
): boolean {
	const previous = before ?? {};
	const previousKeys = Object.keys(previous);
	const nextKeys = Object.keys(after);

	if (previousKeys.length !== nextKeys.length) {
		return true;
	}

	return nextKeys.some(key => previous[key]?.snapshotId !== after[key]?.snapshotId);
}
