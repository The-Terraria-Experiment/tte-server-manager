/**
 * Shared read model for the repo's asynchronously-invoked jobs (worldgen, instance shutdown).
 *
 * Every one of these follows the same shape: a single Dynamo row is the only record that the job
 * exists, a worker invoked with `InvocationType: "Event"` heartbeats `updatedAt` as it goes, and
 * multiple callers — the status endpoint, the queue endpoint, any guard — each have to answer "is
 * this job still alive?". They must answer it *identically*. Two different answers means either a
 * permanently wedged resource (queue says busy, status says finished) or two workers running at once.
 *
 * The staleness threshold is a parameter rather than a constant because it belongs to the job type:
 * it has to exceed that worker's longest legitimate gap between Dynamo writes, which is a property of
 * what the worker does, not of this module. See the per-job wrappers in WorldgenJob / ShutdownJob.
 */

/** The minimum a job row has to expose for its liveness to be judged. */
export type AsyncJobLike = {
	status?: string;
	createdAt?: string;
	updatedAt?: string;
};

/** Statuses a worker writes when it is done, successfully or not. */
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function isJobTerminal(job: AsyncJobLike | null): boolean {
	return Boolean(job?.status && TERMINAL_STATUSES.has(job.status));
}

/**
 * Milliseconds since the job last showed signs of life, or `null` when it has no usable timestamp
 * (an unparseable or missing `updatedAt`/`createdAt` — treated as "can't tell", never as "fresh").
 */
export function jobIdleForMs(job: AsyncJobLike | null): number | null {
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
export function isJobAbandoned(job: AsyncJobLike | null, staleAfterMs: number): boolean {
	if (!job || isJobTerminal(job)) return false;

	const idleFor = jobIdleForMs(job);
	if (idleFor === null) return true;

	return idleFor > staleAfterMs;
}

/**
 * True when the job is genuinely still running, so a fresh request must be refused and any guard
 * keyed off it must fire. Terminal and abandoned rows are leftovers, not competition, and get
 * overwritten by the next job.
 */
export function isJobBlocking(job: AsyncJobLike | null, staleAfterMs: number): boolean {
	if (!job) return false;

	return !isJobTerminal(job) && !isJobAbandoned(job, staleAfterMs);
}
