import { TShockAPI } from "../tshock/TShockAPI.js";
import { isRefusedConnectionEnvelope } from "../tshock/InventoryReport.js";
import { DEFAULT_KICK_REASON } from "./ItemRuleShape.js";
import type { ItemRulesEntry, ViolationItem, ViolationKickResult } from "../../schema/SystemTable.js";

/**
 * The automated half of the item rules: removing a player who joined with something they shouldn't
 * have, rather than only flagging them for whoever happens to be watching.
 *
 * Everything here is **best-effort and never retried**, the same contract as the snapshot archive.
 * The scan is a moderation feature that has to keep working when the game server does not, so a kick
 * that fails is recorded on the violation and the drain carries on — the flag is still raised, and a
 * moderator still has everything they had before this existed. What must never happen is a failed
 * kick taking the drain down with it: that would leave the cursor unwritten and the same snapshots
 * re-evaluated on the next pass, which on a broken server is an unbounded loop.
 */

/**
 * Wall clock for one pass's kicks. Sized alongside `DRAIN_BUDGET_MS` and `ARCHIVE_BUDGET_MS` against
 * `SCAN_LEASE_MS` — the three per-pass budgets and the lease are one invariant, not four knobs. Small
 * because a kick is a single short REST call and the normal case is zero or one of them; the budget
 * exists for the pathological case (a whitelist misconfiguration flagging a full server) rather than
 * the expected one.
 */
export const KICK_BUDGET_MS = 5000;

/** Offending item names named in the kick message before it degrades to a count. */
const NAMED_ITEMS = 3;

/**
 * Builds what the kicked player sees.
 *
 * The item names are appended rather than left to the operator's message because the player is the
 * only person who can resolve this, and "you have a disallowed item" without saying which one sends
 * them back in with the same inventory. Capped at a few names — a whitelist violation can run to
 * hundreds, and TShock puts this on a disconnect screen.
 */
export function buildKickReason(rules: ItemRulesEntry | null, offending: ViolationItem[]): string {
	const message = rules?.enforcement?.kickReason?.trim() || DEFAULT_KICK_REASON;

	const named = offending
		.slice(0, NAMED_ITEMS)
		.map(item => item.name || `item #${item.netId}`)
		.join(", ");

	if (!named) {
		return message;
	}

	const remainder = offending.length - NAMED_ITEMS;
	return `${message} (${named}${remainder > 0 ? ` and ${remainder} more` : ""})`;
}

export type KickOutcome = {
	results: Record<string, ViolationKickResult>,
	/** The game server stopped answering, so the remaining players were not attempted. */
	unreachable: boolean,
	/** Ran out of budget with players left to kick. They keep their flag and no kick record. */
	truncated: boolean,
};

/**
 * Kicks each of `players`, one call apiece.
 *
 * Takes a player list rather than being called per snapshot so that someone who joined twice inside
 * one drain is kicked once, off their final state: the first capture may well be the one that was
 * already kicked, and a second call would either hit nobody or eject a session that had already been
 * dealt with.
 *
 * Stops early on a refused connection. `TShockAPI` reports that as a `{ server: { status: false } }`
 * envelope rather than throwing, so without the check every remaining player would be "kicked"
 * against a server that is not running — recorded as a success, which is the one outcome here that
 * would actively mislead.
 */
export async function kickViolators(
	instanceIp: string,
	userID: string,
	players: { player: string, offending: ViolationItem[] }[],
	rules: ItemRulesEntry | null,
	options: { budgetMs?: number } = {},
): Promise<KickOutcome> {
	const { budgetMs = KICK_BUDGET_MS } = options;

	const results: Record<string, ViolationKickResult> = {};
	const deadline = Date.now() + budgetMs;
	const TShock = new TShockAPI(instanceIp);

	let unreachable = false;
	let truncated = false;

	for (const [index, target] of players.entries()) {
		// Checked before each call rather than only between them, so one slow REST call can't be
		// followed by a dozen more on an exhausted budget. The first is always attempted — a budget that
		// can kick nobody is worse than one that overruns slightly.
		if (index > 0 && Date.now() >= deadline) {
			truncated = true;
			break;
		}

		const reason = buildKickReason(rules, target.offending);

		try {
			const result = await TShock.APIRequest(userID, "/v2/players/kick", {
				player: target.player,
				reason,
			});

			if (isRefusedConnectionEnvelope(result)) {
				unreachable = true;
				break;
			}

			results[target.player] = { at: Date.now(), ok: true };
		} catch (e: any) {
			// The commonest failure by far is the player having already disconnected between the capture
			// and this call, which TShock answers with an error. That is the desired end state reached
			// another way, but it is not distinguishable here from a real failure, so it is recorded
			// honestly rather than reported as a successful kick.
			results[target.player] = {
				at: Date.now(),
				ok: false,
				error: String(e?.message ?? "unknown").slice(0, 200),
			};
		}
	}

	return { results, unreachable, truncated };
}
