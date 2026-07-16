import type { Context } from "aws-lambda";

/**
 * Shared wait budget for the shutdown-path syncs.
 *
 * These syncs have to finish while the instance is still online (SSM can't run once the box is
 * powering off), but they must never outlive the lambda itself: the EC2 stop is issued *after* them,
 * so an invocation killed mid-poll never stops the instance at all. Deriving the budget from the
 * invocation's own remaining time keeps the bounded wait honest across callers with different
 * timeouts (instance-manager 30s, auto-shutoff-manager 15s) instead of hardcoding a ceiling that
 * silently exceeds both and turns a "log and proceed" fallback into a hard timeout.
 */

/** Wall-clock room left for the work after the syncs: the EC2 stop call, state writes, and logging. */
const POST_SYNC_RESERVE_MS = 5000;

/** Absolute epoch-ms at which the shutdown syncs must stop waiting and let the stop proceed. */
export function shutdownSyncDeadline(context: Context, reserveMs = POST_SYNC_RESERVE_MS): number {
	return Date.now() + Math.max(0, context.getRemainingTimeInMillis() - reserveMs);
}

/** How many `intervalMs` polls fit before `deadline`. Zero means "don't wait at all". */
export function pollsUntilDeadline(deadline: number, intervalMs: number): number {
	return Math.max(0, Math.floor((deadline - Date.now()) / intervalMs));
}
