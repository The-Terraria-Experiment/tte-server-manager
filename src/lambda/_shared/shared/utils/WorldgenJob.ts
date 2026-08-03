import type { SystemWorldCreateEntry } from "../schema/SystemTable.js";

/**
 * Shared read model for the single in-flight worldgen row (`worldgen#<instanceID>`).
 *
 * The row is the only thing standing between a user and a second world-creation attempt, so its
 * "is this job still alive?" question has to be answered the same way everywhere: the status
 * endpoint uses it to decide whether to keep the client polling, and the queue endpoint uses it to
 * decide whether to refuse a new request. Two different answers means either a permanently wedged
 * instance (queue says busy, status says finished) or two concurrent worldgen runs.
 */

/** Statuses the worker writes when it is done, successfully or not. */
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

/**
 * How long a non-terminal job may go without a heartbeat before it's treated as abandoned.
 *
 * The worker touches `updatedAt` on every poll of the world file (~10s apart), so a gap much larger
 * than that means the invocation is gone — killed by the lambda timeout, an OOM, or a crash between
 * the Dynamo write and the catch block. None of those leave a terminal status behind, which is
 * exactly the case this exists to unstick.
 *
 * The ceiling on this is the worker's longest legitimate gap between Dynamo writes — currently the
 * config-password write plus the SSM dispatch that starts TShock, before the polling loop begins.
 * Anything added to the worker that can run longer than this without touching the row makes a live
 * job look dead, and a second world creation could then be started on top of it.
 */
const DEFAULT_STALE_MS = 3 * 60 * 1000;

export function worldgenStaleAfterMs(): number {
	const configured = Number(process.env.WORLD_CREATE_STALE_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_STALE_MS;
}

export function isWorldgenTerminal(job: SystemWorldCreateEntry | null): boolean {
	return Boolean(job?.status && TERMINAL_STATUSES.has(job.status));
}

/**
 * Milliseconds since the job last showed signs of life, or `null` when it has no usable timestamp
 * (an unparseable or missing `updatedAt`/`createdAt` — treated as "can't tell", never as "fresh").
 */
export function worldgenIdleForMs(job: SystemWorldCreateEntry | null): number | null {
	const stamp = job?.updatedAt || job?.createdAt;
	if (!stamp) return null;

	const at = Date.parse(stamp);
	if (!Number.isFinite(at)) return null;

	return Math.max(0, Date.now() - at);
}

/**
 * True when a non-terminal job has stopped heartbeating: its worker died without recording an
 * outcome. Callers should treat it as finished-with-unknown-result rather than in progress.
 * A job with no readable timestamp counts as abandoned — an unreadable row can't be waited on.
 */
export function isWorldgenAbandoned(job: SystemWorldCreateEntry | null): boolean {
	if (!job || isWorldgenTerminal(job)) return false;

	const idleFor = worldgenIdleForMs(job);
	if (idleFor === null) return true;

	return idleFor > worldgenStaleAfterMs();
}

/**
 * True when a fresh creation request must be refused because one is genuinely still running.
 * Terminal and abandoned rows are leftovers, not competition, and get overwritten by the new job.
 */
export function isWorldgenBlocking(job: SystemWorldCreateEntry | null): boolean {
	if (!job) return false;

	return !isWorldgenTerminal(job) && !isWorldgenAbandoned(job);
}
