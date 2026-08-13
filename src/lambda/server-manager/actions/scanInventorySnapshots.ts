import type { APIGatewayProxyResult, Context } from "aws-lambda";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { delay } from "../shared/utils/core/Delay.js";
import { Realtime } from "../shared/utils/realtime/RealtimePublisher.js";
import { drainSnapshots, evaluateReport, ServerUnreachableError } from "../shared/utils/tshock/InventorySnapshots.js";
import {
	clearScanPending,
	claimScanLease,
	hasActiveRules,
	isScanPending,
	markScanPending,
	pruneViolations,
	readItemRules,
	readScanState,
	releaseScanLease,
	violationsChanged,
	VIOLATION_ITEM_CAP,
	writeScanResult,
	type InventoryScanRequestData,
} from "../shared/utils/jobs/ItemRuleScan.js";
import type { PlayerViolation } from "../shared/schema/SystemTable.js";

/**
 * Drains the InventoryMonitor plugin's snapshot cache and checks each join capture against the
 * instance's item rules.
 *
 * Woken by `pushLog` on every join *and* leave, and by the Scan now button. Runs as an asynchronous
 * worker rather than inside the request that triggered it, so it is bounded by its own budget rather
 * than by API Gateway's 29s integration timeout — and so a slow game server can never make a log
 * push time out.
 */

/**
 * The plugin captures a join snapshot `JoinSnapshotDelayTicks` (60, ~1s) *after* the join, while the
 * log push that wakes us is immediate. Draining straight away would reliably miss the very snapshot
 * we were woken for, and only pick it up on the next player's join.
 */
const JOIN_CAPTURE_DELAY_MS = 1500;

/** Wall clock for one drain. Well under the lease, with room for the passes below. */
const DRAIN_BUDGET_MS = 15000;

/**
 * Passes per invocation. More than one because events that arrive mid-drain set `pending` rather
 * than starting a competing drain; this is where those get serviced. Bounded so a server with a
 * continuous stream of joins can't hold one invocation open indefinitely — the next join wakes a
 * fresh worker, which is cheaper than a long-running one.
 */
const MAX_PASSES = 3;

export const scanInventorySnapshots = async (
	event: InventoryScanRequestData,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const { instanceID, requestedBy, reason } = event;

	if (!instanceID) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	// Cheapest possible exit, and the one that runs most often. `logs-manager` checks this too before
	// invoking, so reaching here with the rules off means they were switched off in between.
	const rules = await readItemRules(instanceID);
	if (!hasActiveRules(rules)) {
		return ResponseUtil.Success({ scanned: false, reason: "rules-inactive" });
	}

	const owner = `${context.awsRequestId}`;
	if (!(await claimScanLease(instanceID, owner))) {
		// Someone else is draining. Flagging is not a consolation prize — the holder re-reads this and
		// runs another pass, so the snapshot behind *this* invocation still gets scanned.
		await markScanPending(instanceID);
		return ResponseUtil.Success({ scanned: false, reason: "lease-held" });
	}

	const state = await readScanState(instanceID);
	let cursor = state?.cursor ?? 0;
	let head = state?.head ?? 0;
	const violationsBefore = state?.violations ?? {};
	let violations: Record<string, PlayerViolation> = { ...violationsBefore };

	/**
	 * Every player this drain reached a conclusion about, flagged or cleared. Only these are written
	 * back, so a flag an operator dismissed while the drain was running is not resurrected by it —
	 * see `writeScanResult`. Anyone this drain saw no capture for is simply left as they were.
	 */
	const affected = new Set<string>();

	let joinsEvaluated = 0;
	let leavesSkipped = 0;
	let pagesDrained = 0;
	let sawGap = false;
	let sawRewind = false;
	let truncated = false;

	try {
		const EC2 = new Ec2Dao();
		const instance = await EC2.GetInstanceStatus(instanceID);
		const instanceIP = instance.privateIp;

		if (!instanceIP || instanceIP === "PENDING") {
			await releaseScanLease(instanceID, "no-ip");
			return ResponseUtil.Success({ scanned: false, reason: "instance-unreachable" });
		}

		for (let pass = 0; pass < MAX_PASSES; pass++) {
			// Cleared before the drain, so a request arriving during it wins another pass rather than
			// being swallowed by a clear that runs afterwards.
			await clearScanPending(instanceID);
			await delay(JOIN_CAPTURE_DELAY_MS);

			const drain = await drainSnapshots(instanceIP, requestedBy, {
				since: cursor,
				groups: rules!.groups,
				budgetMs: DRAIN_BUDGET_MS,
				lastScanAt: state?.lastScanAt ?? null,
			});

			cursor = drain.cursor;
			head = drain.head;
			pagesDrained += drain.pages;
			sawGap = sawGap || drain.gap;
			sawRewind = sawRewind || drain.rewound;
			truncated = truncated || drain.truncated;

			// Ascending by id, so a player who joined twice in one drain correctly ends on their latest.
			for (const snapshot of drain.snapshots) {
				// Leave captures are drained past but not judged: the rules describe what someone may
				// *arrive* with. They still have to come through here, because the cursor is a single
				// global id floor — there is no way to skip them without skipping the joins between them.
				if (snapshot.kind !== "join") {
					leavesSkipped++;
					continue;
				}

				const player = snapshot.player.name;
				if (!player) {
					continue;
				}

				joinsEvaluated++;
				const offending = evaluateReport(snapshot.player, rules!);

				affected.add(player);

				if (!offending.length) {
					// A clean join clears the flag. Without this, "latest per player" would mean "worst
					// ever", and a player who dropped the item would stay marked forever.
					delete violations[player];
					continue;
				}

				violations[player] = {
					player,
					...(snapshot.account ? { account: snapshot.account } : {}),
					kind: snapshot.kind,
					at: snapshot.capturedAt,
					snapshotId: snapshot.id,
					mode: rules!.mode ?? "blacklist",
					items: offending.slice(0, VIOLATION_ITEM_CAP),
					itemCount: offending.length,
					...(offending.length > VIOLATION_ITEM_CAP ? { truncated: true } : {}),
				};
			}

			if (!(await isScanPending(instanceID))) {
				break;
			}
		}

		// Pruning drops players this drain never saw, so those have to join the affected set too —
		// otherwise the row keeps growing, since nothing else would ever write their removal.
		const beforePrune = Object.keys(violations);
		violations = pruneViolations(violations);
		beforePrune.filter(player => !violations[player]).forEach(player => affected.add(player));

		// Split the affected players by what they ended up as. A player flagged and then cleared
		// within the same drain (joined dirty, rejoined clean) correctly lands in removals.
		const upserts: Record<string, PlayerViolation> = {};
		const removals: string[] = [];
		for (const player of affected) {
			const violation = violations[player];
			if (violation) {
				upserts[player] = violation;
			} else {
				removals.push(player);
			}
		}

		await writeScanResult(instanceID, {
			cursor,
			head,
			upserts,
			removals,
			status: truncated ? "truncated" : "ok",
		});

		const changed = violationsChanged(violationsBefore, violations);

		// Strictly after the write, and only on a real change. Every join runs a scan; publishing
		// unconditionally would cost each open browser a refetch per join, which is exactly the
		// per-player-activity load this pipeline is elsewhere careful to avoid.
		if (changed) {
			await Realtime.PublishServerViolations(instanceID, String(Object.keys(violations).length));
		}

		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: requestedBy,
			action: "inventory-scan",
			status: "ok",
			resource: `instance::${instanceID}`,
			details: {
				instanceID,
				reason,
				joinsEvaluated,
				leavesSkipped,
				pagesDrained,
				cursor,
				head,
				flagged: Object.keys(violations).length,
				changed,
				truncated,
				// Snapshots aged out of the plugin's cache before we drained them. Not recoverable, but
				// the only signal that the scan has an unseen blind spot.
				gap: sawGap,
				// The game server restarted and re-zeroed its snapshot ids; the cursor was reset.
				rewound: sawRewind,
			},
		});

		return ResponseUtil.Success({ scanned: true, flagged: Object.keys(violations).length, changed });
	} catch (e: any) {
		const unreachable = e instanceof ServerUnreachableError;

		// The cursor is deliberately not written on this path: the drain read nothing it can vouch for,
		// and recording a cursor here would skip past snapshots that were never evaluated.
		await releaseScanLease(instanceID, unreachable ? "unreachable" : "failed");

		CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			userId: requestedBy,
			action: "inventory-scan",
			error: e?.message ?? "unknown",
			stack: new Error().stack,
			details: { instanceID, reason, cursor, pagesDrained },
		});

		// Returned rather than rethrown: this worker is invoked asynchronously, so a throw would have
		// lambda retry it against a lease that is now free — and the next roster event will drain from
		// the same cursor anyway.
		return ResponseUtil.Error(e?.message || "Inventory scan failed");
	}
};
