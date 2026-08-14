import { TShockAPI } from "./TShockAPI.js";
import { isRefusedConnectionEnvelope, type InventoryReport } from "./InventoryReport.js";

/**
 * Destructive edits to a live player inventory — the moderation half of the InventoryMonitor
 * integration, where `InventoryReport` is the read half.
 *
 * **Removal only.** The plugin exposes nothing that adds or alters an item and nothing here should
 * ever grow one: an operator who can hand out items is a different feature with a different risk
 * profile, and the permission this sits behind (`server.player.inventory.write`) is documented to
 * users as destroy-only.
 *
 * Two properties of the plugin shape everything below.
 *
 * **1. A removal is best-effort, not a guarantee.** The fleet runs without ServerSideCharacters, so
 * the *client* owns its inventory; the plugin clears the slot server-side, pushes a `PlayerSlot`
 * packet, and then re-clears for `RemovalRetryCount` passes in case the client puts it back. The REST
 * call returns `removed: true` after the *first* clear, before any of that verification has happened,
 * so a 200 here means "attempted and initially applied", never "the item is gone". Callers must
 * re-read afterwards and treat that read as the authoritative result rather than trusting this.
 *
 * **2. `globalSlot` is the address, not `slot`.** `InventorySlotEntry.slot` is the index *within* a
 * container and repeats across them — slot 0 exists in `Inventory`, `Armor`, `PiggyBank` and a dozen
 * others. `/inventory/removeslot` takes the canonical 0-349 index, so passing `slot` would delete a
 * near-arbitrary item and look like it worked.
 */

/**
 * Wall clock for one request's removals, sized against **API Gateway's 29s integration timeout**
 * rather than the lambda's own, exactly like `SYNC_POLL_BUDGET_MS` and `METRICS_READ_BUDGET_MS`. Each
 * removal is its own REST round trip through `tshock-proxy`, so clearing a hoarder's storage can be
 * a hundred-plus calls; overrunning would hand the operator a 504 while the removals kept happening,
 * which is the one outcome that makes a destructive action untrustworthy.
 *
 * Leaves room for the two reads that bracket the loop (the resolve read and the confirm re-read) plus
 * a cold start. Running out is not a failure — it is reported as `truncated` and the caller re-issues.
 */
export const REMOVE_BUDGET_MS = 18000;

/** Scopes `/inventory/clear` understands. Anything else is treated by the plugin as `all`. */
export const CLEAR_SCOPES = ["all", "main", "core", "storage", "misc", "loadouts"] as const;
export type ClearScope = typeof CLEAR_SCOPES[number];

export const isClearScope = (value: unknown): value is ClearScope =>
	typeof value === "string" && (CLEAR_SCOPES as readonly string[]).includes(value);

/** One slot the caller wants gone. `netId` is the item the *operator was looking at* — see `resolveRemovalTargets`. */
export type SlotRemovalRequest = {
	globalSlot: number,
	netId?: number,
};

/** A slot resolved against the live report, carrying enough detail to make a useful audit record. */
export type ResolvedTarget = {
	globalSlot: number,
	netId: number,
	name: string,
	stack: number,
	prefix: number,
	container: string,
};

export type SkippedChange = {
	globalSlot: number,
	expectedNetId: number,
	actualNetId: number,
	actualName: string,
};

export type TargetResolution = {
	targets: ResolvedTarget[],
	/** Nothing is in the slot any more. Already the desired end state, so not an error. */
	skippedEmpty: number[],
	/** Something *else* is in the slot now. Deliberately left alone. */
	skippedChanged: SkippedChange[],
};

/**
 * Matches the caller's requested slots against what is actually in the player's inventory right now.
 *
 * This is the safety property of the whole feature. An operator selects slots from a report that was
 * fetched seconds-to-minutes ago, and Terraria players rearrange their inventory constantly — so by
 * the time the request lands, the slot the operator clicked may hold something entirely different.
 * Removing it anyway would destroy an item nobody chose, off a UI that showed the right thing at the
 * time, and the operator would have no way to tell it had happened.
 *
 * So a request that carries `netId` is treated as an assertion about what the operator saw, and a slot
 * whose contents no longer match is reported back rather than removed. `netId` is optional only so a
 * caller can deliberately opt out (e.g. clearing a whole container, where the intent is positional
 * rather than item-specific); when it is absent, whatever occupies the slot is removed.
 */
export function resolveRemovalTargets(report: InventoryReport, requested: SlotRemovalRequest[]): TargetResolution {
	const live = new Map<number, ResolvedTarget>();
	for (const container of report.containers) {
		for (const item of container.items) {
			live.set(item.globalSlot, {
				globalSlot: item.globalSlot,
				netId: item.netId,
				name: item.name,
				stack: item.stack,
				prefix: item.prefix,
				container: container.name,
			});
		}
	}

	const targets: ResolvedTarget[] = [];
	const skippedEmpty: number[] = [];
	const skippedChanged: SkippedChange[] = [];

	for (const request of requested) {
		const actual = live.get(request.globalSlot);

		if (!actual) {
			// The plugin only emits occupied slots, so an absent entry means the slot is empty. The
			// player dropped it, used it, or another operator got there first.
			skippedEmpty.push(request.globalSlot);
			continue;
		}

		if (request.netId !== undefined && request.netId !== actual.netId) {
			skippedChanged.push({
				globalSlot: request.globalSlot,
				expectedNetId: request.netId,
				actualNetId: actual.netId,
				actualName: actual.name,
			});
			continue;
		}

		targets.push(actual);
	}

	return { targets, skippedEmpty, skippedChanged };
}

export type RemovalOutcome = {
	removed: ResolvedTarget[],
	failed: { globalSlot: number, error: string }[],
	/** Ran out of budget with targets left. They are untouched; the caller may re-issue. */
	truncated: boolean,
	/** The game server stopped answering. Remaining targets were not attempted. */
	unreachable: boolean,
};

/**
 * Removes each target, one REST call apiece.
 *
 * Modelled on `kickViolators`: best-effort, never retried, per-target results, and an early break on
 * a refused connection. That last check is load-bearing for the same reason it is there — `TShockAPI`
 * answers a refused connection with a `{ server: { status: false } }` envelope instead of throwing,
 * so without it every remaining slot would be recorded as successfully removed against a server that
 * is not running. Reporting a destroyed item that still exists is the worst failure this code has
 * available to it.
 */
export async function removeSlots(
	instanceIp: string,
	userID: string,
	player: string,
	targets: ResolvedTarget[],
	options: { budgetMs?: number } = {},
): Promise<RemovalOutcome> {
	const { budgetMs = REMOVE_BUDGET_MS } = options;

	const removed: ResolvedTarget[] = [];
	const failed: { globalSlot: number, error: string }[] = [];
	const deadline = Date.now() + budgetMs;
	const TShock = new TShockAPI(instanceIp);

	let unreachable = false;
	let truncated = false;

	for (const [index, target] of targets.entries()) {
		// Checked before each call rather than only between them, so one slow round trip can't be
		// followed by a hundred more on an exhausted budget. The first is always attempted.
		if (index > 0 && Date.now() >= deadline) {
			truncated = true;
			break;
		}

		try {
			const result = await TShock.APIRequest(userID, "/inventory/removeslot", {
				player,
				slot: target.globalSlot,
			});

			if (isRefusedConnectionEnvelope(result)) {
				unreachable = true;
				break;
			}

			// The plugin reports a bad slot as a RestObject carrying `error`. Whether TShock surfaces
			// that as an HTTP 4xx (which `TShockAPI` throws on, caught below) or as a 200 with the code
			// mirrored into the body depends on the build, so both shapes are handled — a body-level
			// error read as a success would claim an item was destroyed when it wasn't.
			if (result?.error) {
				failed.push({ globalSlot: target.globalSlot, error: String(result.error).slice(0, 200) });
				continue;
			}

			removed.push(target);
		} catch (e: any) {
			failed.push({
				globalSlot: target.globalSlot,
				error: String(e?.message ?? "unknown").slice(0, 200),
			});
		}
	}

	return { removed, failed, truncated, unreachable };
}

export type ClearOutcome = {
	scope: ClearScope,
	slotsCleared: number,
	unreachable: boolean,
};

/**
 * Empties a whole scope in one call.
 *
 * Kept separate from `removeSlots` rather than expanded into a slot list because the plugin does the
 * whole job server-side in a single round trip — a full `all` clear as individual removals would be
 * hundreds of calls through `tshock-proxy` and would blow the budget on exactly the case an operator
 * most wants to be quick. The cost is that there is no per-item audit detail, which is why the caller
 * logs the pre-clear inventory contents instead.
 *
 * Note `main` is only the `Inventory` container (slots 0-58), *not* everything a player is carrying;
 * `core` is the one that also covers armor and dyes.
 */
export async function clearScope(
	instanceIp: string,
	userID: string,
	player: string,
	scope: ClearScope,
): Promise<ClearOutcome> {
	const TShock = new TShockAPI(instanceIp);

	const result = await TShock.APIRequest(userID, "/inventory/clear", { player, scope });

	if (isRefusedConnectionEnvelope(result)) {
		return { scope, slotsCleared: 0, unreachable: true };
	}

	if (result?.error) {
		throw new Error(String(result.error));
	}

	return {
		scope,
		slotsCleared: typeof result?.slotsCleared === "number" ? result.slotsCleared : 0,
		unreachable: false,
	};
}
