import type { APIGatewayProxyResult, Context } from "aws-lambda";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { delay } from "../shared/utils/core/Delay.js";
import { Realtime } from "../shared/utils/realtime/RealtimePublisher.js";
import { drainSnapshots, evaluateReport, ServerUnreachableError } from "../shared/utils/tshock/InventorySnapshots.js";
import type { InventorySnapshot, SnapshotKind } from "../shared/utils/tshock/InventorySnapshots.js";
import { archiveSnapshots, writeSessionManifest } from "../shared/utils/tshock/InventoryArchive.js";
import { ensureSession, rollSession } from "../shared/utils/tshock/ServerSession.js";
import { kickViolators, KICK_BUDGET_MS } from "../shared/utils/jobs/ItemRuleEnforcement.js";
import {
	archiveKinds,
	clearScanPending,
	claimScanLease,
	hasActiveRules,
	isArchiveActive,
	isAutoKickActive,
	isScanActive,
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
import type { PlayerViolation, ServerSession, ViolationItem } from "../shared/schema/SystemTable.js";

/**
 * Drains the InventoryMonitor plugin's snapshot cache: archives each capture to S3, and checks each
 * join capture against the instance's item rules.
 *
 * Woken by `pushLog` on every join *and* leave, and by the Scan now button. Runs as an asynchronous
 * worker rather than inside the request that triggered it, so it is bounded by its own budget rather
 * than by API Gateway's 29s integration timeout — and so a slow game server can never make a log
 * push time out.
 *
 * **The jobs are independently switched.** `isScanActive` decides whether to drain at all;
 * `hasActiveRules` decides whether anything is judged, `isArchiveActive` whether anything is stored,
 * and `isAutoKickActive` whether a judgement has any consequence beyond a flag. An instance with
 * archiving on and no rule list drains and stores while concluding nothing about anybody, which is a
 * supported and deliberate configuration — the archive is a record, not an enforcement mechanism.
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

/**
 * Wall clock for archiving one pass's captures. Sized against `SCAN_LEASE_MS` alongside the drain
 * budget above — three passes of delay + drain + archive is the worst case the lease has to cover,
 * and the two constants are one invariant, not two independent knobs.
 */
const ARCHIVE_BUDGET_MS = 10000;

export const scanInventorySnapshots = async (
	event: InventoryScanRequestData,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const { instanceID, requestedBy, reason } = event;

	if (!instanceID) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	// Cheapest possible exit, and the one that runs most often. `logs-manager` checks this too before
	// invoking, so reaching here with everything off means it was switched off in between.
	const rules = await readItemRules(instanceID);
	if (!isScanActive(rules)) {
		return ResponseUtil.Success({ scanned: false, reason: "rules-inactive" });
	}

	const evaluating = hasActiveRules(rules);
	const archiving = isArchiveActive(rules);
	const kicking = isAutoKickActive(rules);
	const archiveBucket = process.env.S3_LOGS_BUCKET_NAME;
	const kinds = archiveKinds(rules);

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
	let archived = 0;
	let archiveFailed = 0;
	let kicked = 0;
	let kickFailed = 0;
	let kickTruncated = false;
	let serverUnreachable = false;
	let session: ServerSession | null = null;

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

			// Whether this pass has anything to file. Also gates the write below, so that a drain of
			// nothing but leave captures under join-only settings is simply a no-op rather than a call
			// into the archive with no session — which would log a failure on every single leave.
			const hasArchivable = archiving && drain.snapshots.some(snapshot => kinds.includes(snapshot.kind));

			// Resolved only when something is going to be filed under it, so a drain that saw nothing
			// worth keeping doesn't mint a session — an empty session folder is a thing an operator would
			// have to rule out later.
			if (hasArchivable) {
				session = await resolveSession(instanceID, drain.rewound, drain.snapshots[0]?.capturedAt, session);
			}

			/**
			 * Verdicts by snapshot id, so the archive can record what the rules made of each capture at
			 * the moment it was taken. Without that, browsing an old snapshot would mean re-evaluating it
			 * against whatever the list says today — a different question from the one that was asked.
			 */
			const verdicts = new Map<number, ViolationItem[]>();

			/**
			 * Who this pass is going to kick, and what for. Keyed by player rather than by snapshot so a
			 * player who joined twice inside one drain is kicked once, off their latest capture — the
			 * earlier one is a session that has already ended.
			 */
			const pendingKicks = new Map<string, ViolationItem[]>();

			// Ascending by id, so a player who joined twice in one drain correctly ends on their latest.
			for (const snapshot of drain.snapshots) {
				// Leave captures are drained past but not judged: the rules describe what someone may
				// *arrive* with. They still have to come through here, because the cursor is a single
				// global id floor — there is no way to skip them without skipping the joins between them.
				// They *are* archived when configured, which is why this check no longer ends the loop
				// body for them.
				if (snapshot.kind !== "join") {
					leavesSkipped++;
					continue;
				}

				const player = snapshot.player.name;
				if (!player) {
					continue;
				}

				// Archiving runs with the rules off; judging does not.
				if (!evaluating) {
					continue;
				}

				joinsEvaluated++;
				const offending = evaluateReport(snapshot.player, rules!);
				verdicts.set(snapshot.id, offending);

				affected.add(player);

				if (!offending.length) {
					// A clean join clears the flag. Without this, "latest per player" would mean "worst
					// ever", and a player who dropped the item would stay marked forever.
					delete violations[player];
					// And cancels a kick queued off an earlier capture in this same pass: that session is
					// over, and the one they are in now is clean.
					pendingKicks.delete(player);
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

				if (kicking) {
					pendingKicks.set(player, offending);
				}
			}

			// Before the archive, deliberately. Both are best-effort work that follows the evaluation, but
			// only one of them is time-critical: every second between the capture and the kick is a second
			// the player spends on the server with the items. Archiving the same captures a few seconds
			// later costs nothing.
			if (pendingKicks.size) {
				const outcome = await kickViolators(
					instanceIP,
					requestedBy,
					[...pendingKicks].map(([player, offending]) => ({ player, offending })),
					rules,
					{ budgetMs: KICK_BUDGET_MS },
				);

				for (const [player, result] of Object.entries(outcome.results)) {
					// Recorded onto the violation this drain is about to write, so the tile can say that the
					// player was removed — or, more importantly, that they were not.
					const violation = violations[player];
					if (violation) {
						violation.kick = result;
					}

					if (result.ok) {
						kicked++;
					} else {
						kickFailed++;
					}
				}

				// A server that stopped answering is not going to answer the next pass's drain either. Noted
				// rather than thrown: the captures this pass already read were evaluated against the rules
				// perfectly well, and discarding that — which is what the catch below does, cursor and all —
				// would drop real flags because a kick couldn't be delivered. The flag is the part that
				// survives an unreachable server; the kick is the part that doesn't.
				serverUnreachable = serverUnreachable || outcome.unreachable;
				kickTruncated = kickTruncated || outcome.truncated;
			}

			if (hasArchivable) {
				const result = await persistSnapshots({
					bucket: archiveBucket,
					instanceID,
					session,
					snapshots: drain.snapshots,
					kinds,
					verdicts,
					evaluated: evaluating,
				});
				archived += result.written;
				archiveFailed += result.failed;
			}

			// Archived first, since those captures are already in hand and S3 is not what went away.
			if (serverUnreachable) {
				break;
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
			// The drain's own outcome is what this reports, so an unreachable server is only news when the
			// drain itself succeeded and the *kick* was what couldn't be delivered — a state worth
			// surfacing in the tile, since it means a flagged player is still on the server.
			status: serverUnreachable ? "kick-unreachable" : truncated ? "truncated" : "ok",
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
				// Which run of the game server these captures were filed under, and how many landed.
				// Archiving is best-effort and a failed write is never retried, so `archiveFailed` is the
				// only record that those captures ever existed.
				sessionID: session?.sessionId ?? null,
				archived,
				archiveFailed,
				// Automated enforcement. `kickFailed` is the line worth alerting on: it means a player was
				// judged, was supposed to be removed, and as far as we know is still playing.
				autoKick: kicking,
				kicked,
				kickFailed,
				kickTruncated,
				kickUnreachable: serverUnreachable,
			},
		});

		return ResponseUtil.Success({
			scanned: true,
			flagged: Object.keys(violations).length,
			changed,
			kicked,
			archived,
			...(session ? { sessionID: session.sessionId } : {}),
		});
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

/**
 * The session these captures belong to.
 *
 * `rewound` means the plugin re-zeroed its ids, which only happens when the game server process
 * restarted — so it is the one signal available here that a run ended and another began without
 * anyone telling us. It is a *reconciliation* path: the authoritative mint is `launchWorld`, which
 * knows the real start time, the world, and who asked for it. This is the fallback for a server that
 * came up some other way.
 *
 * Anchored on the first capture's timestamp rather than now, because that is the closest thing to a
 * start time in hand — the alternative dates a detected session to the moment somebody happened to
 * join it.
 *
 * The one restart this misses: `rewound` is `head < cursor`, so a new run that issued more ids than
 * the old cursor before the first drain looks like a continuation. Drains fire on every join, so the
 * first one after a restart sees `head = 1` — below any cursor above 1. The gap is a previous
 * session whose cursor was 0 or 1, which by definition archived nothing. Left as-is deliberately;
 * closing it properly means a run id from the plugin, not a heuristic here.
 */
async function resolveSession(
	instanceID: string,
	rewound: boolean,
	anchorAt: number | undefined,
	existing: ServerSession | null,
): Promise<ServerSession> {
	// Already rolled for this rewind earlier in the same invocation — `drain.rewound` stays true for
	// every later pass, and rolling again would split one run across several sessions.
	if (rewound && !existing) {
		return rollSession(instanceID, { ...(anchorAt ? { anchorAt } : {}) });
	}

	return existing ?? ensureSession(instanceID, { ...(anchorAt ? { anchorAt } : {}) });
}

/**
 * Writes a pass's captures, and the session manifest the first time that session is written to.
 *
 * Best-effort throughout, matching `archiveSnapshots`' own contract: the scan is a moderation
 * feature that has to keep working when S3 does not, so nothing here can fail the drain. The cost is
 * that the cursor advances regardless, so a capture whose write failed is gone rather than retried —
 * which is why the counts reach the action log rather than being swallowed.
 */
async function persistSnapshots(params: {
	bucket: string | undefined,
	instanceID: string,
	session: ServerSession | null,
	snapshots: InventorySnapshot[],
	kinds: SnapshotKind[],
	verdicts: Map<number, ViolationItem[]>,
	evaluated: boolean,
}): Promise<{ written: number, failed: number }> {
	const { bucket, instanceID, session, snapshots, kinds, verdicts, evaluated } = params;

	if (!bucket || !session) {
		// An unset S3_LOGS_BUCKET_NAME is the per-environment kill switch for archiving, in the same
		// spirit as the unset function ARNs elsewhere: no deploy needed, and the scan carries on.
		await CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			userId: null,
			action: "inventory-archive",
			error: bucket ? "No session to file captures under" : "S3_LOGS_BUCKET_NAME not set; skipping snapshot archive",
			details: { instanceID },
		});
		return { written: 0, failed: 0 };
	}

	try {
		// Written on every pass rather than tracked — `PutJsonObject` over the same key is idempotent,
		// and one small put per drain is cheaper than the state needed to know whether it was already
		// there. It also self-heals a manifest lost to a failed write.
		await writeSessionManifest(bucket, session);
	} catch {
		// The manifest is provenance, not data. Losing it costs a label in the browser, not a capture.
	}

	const result = await archiveSnapshots(bucket, instanceID, session.sessionId, snapshots, {
		kinds,
		budgetMs: ARCHIVE_BUDGET_MS,
		verdicts,
		evaluated,
	});

	return { written: result.written, failed: result.failed };
}
