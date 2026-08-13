import { DynamoDao } from "../../aws/DynamoDB.js";
import { INVENTORY_SCAN_KEY, ITEM_RULES_KEY, SYSTEM_TABLE } from "../../vars.js";
import type { InventoryScanEntry, ItemRulesEntry, PlayerViolation } from "../../schema/SystemTable.js";

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
 */
export const SCAN_LEASE_MS = 90 * 1000;

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
		UpdateExpression: "SET #lease = :until, #owner = :owner, #instance = :instance, #pending = :pending",
		ExpressionAttributeNames: {
			"#lease": "leaseUntil",
			"#owner": "leaseOwner",
			"#instance": "instanceID",
			"#pending": "pending",
		},
		ExpressionAttributeValues: {
			":until": now + SCAN_LEASE_MS,
			":owner": owner,
			":instance": instanceId,
			":pending": false,
			":now": now,
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
 */
export async function writeScanResult(
	instanceId: string,
	result: {
		cursor: number,
		head: number,
		violations: Record<string, PlayerViolation>,
		status: string,
	},
): Promise<void> {
	const DB = new DynamoDao();
	await DB.UpdateItem(SYSTEM_TABLE, inventoryScanKey(instanceId), {
		updates: {
			instanceID: instanceId,
			cursor: result.cursor,
			head: result.head,
			violations: result.violations,
			lastScanAt: Date.now(),
			lastScanStatus: result.status,
			leaseUntil: 0,
			pending: false,
			updatedAt: new Date().toISOString(),
		} satisfies InventoryScanEntry,
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
