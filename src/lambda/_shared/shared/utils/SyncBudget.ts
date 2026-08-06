import type { Context } from "aws-lambda";

/**
 * Shared wait budget for long in-lambda waits.
 *
 * The shutdown syncs are the original case: they have to finish while the instance is still online
 * (SSM can't run once the box is powering off), but they must never outlive the lambda itself,
 * because the EC2 stop is issued *after* them — an invocation killed mid-poll never stops the
 * instance at all. Deriving the budget from the invocation's own remaining time keeps the bounded
 * wait honest across callers with different timeouts, instead of hardcoding a ceiling that silently
 * exceeds them and turns a "log and proceed" fallback into a hard timeout.
 */

/**
 * Absolute epoch-ms at which a bounded wait must give up, leaving `reserveMs` of the invocation for
 * whatever has to happen afterwards.
 *
 * Every long wait in a lambda needs one of these. A wait sized in fixed poll counts is really a bet
 * that the polls are faster than the function timeout, and when that bet loses the invocation is
 * killed mid-loop: no catch block, no finally, no terminal state written anywhere. Deriving the
 * budget from the invocation's own remaining time is what keeps "gave up" a state the code can
 * actually reach and report.
 */
export function boundedWaitDeadline(context: Context, reserveMs: number): number {
	return Date.now() + Math.max(0, context.getRemainingTimeInMillis() - reserveMs);
}

/** How many `intervalMs` polls fit before `deadline`. Zero means "don't wait at all". */
export function pollsUntilDeadline(deadline: number, intervalMs: number): number {
	return Math.max(0, Math.floor((deadline - Date.now()) / intervalMs));
}
