import type { APIGatewayProxyResult } from "aws-lambda";
import type { SystemShutdownEntry } from "../schema/SystemTable.js";
import { DynamoDao } from "../aws/DynamoDB.js";
import { LambdaDao } from "../aws/Lambda.js";
import { SHUTDOWN_KEY, SYSTEM_TABLE } from "../vars.js";
import { ResponseUtil } from "./APIResponse.js";
import { isJobAbandoned, isJobBlocking, isJobTerminal, jobIdleForMs } from "./AsyncJob.js";

/**
 * Shared read model for the single in-flight instance-shutdown row (`shutdown#<instanceID>`).
 *
 * The shutdown is no longer a request that completes before the response — it is a job that outlives
 * it, and for the minutes it runs the instance is being torn down underneath whatever the user is
 * looking at. So this row answers two questions, and both have to be answered identically
 * everywhere: "what stage is it at?" (the status endpoints) and "may this action mutate the
 * instance right now?" (the guards). A disagreement between those two is a file upload racing an
 * `aws s3 sync` that is already archiving the file, against a box that is about to lose power.
 *
 * The mechanics live in {@link AsyncJob}, shared with worldgen; what stays here is the part specific
 * to shutdown — its staleness threshold, the wire shape, and the guard.
 */

/** Error code returned to the frontend when an action is refused because a shutdown is running. */
export const SHUTDOWN_IN_PROGRESS_CODE = "SHUTDOWN_IN_PROGRESS";

/**
 * How long a non-terminal job may go without a heartbeat before it's treated as abandoned.
 *
 * The worker touches `updatedAt` between tasks, not during them, so the ceiling on this is the
 * largest per-task `maxMs` in the registry (currently 120s for the file sync). It must stay
 * comfortably above that: set it lower and a task that is legitimately still running makes the job
 * look dead, which both drops the guards and lets a second shutdown be queued on top of it. Raising
 * a task's `maxMs` past this window is the same bug — change the two together.
 */
const DEFAULT_STALE_MS = 3 * 60 * 1000;

export function shutdownStaleAfterMs(): number {
	const configured = Number(process.env.SHUTDOWN_STALE_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_STALE_MS;
}

export function shutdownJobKey(instanceId: string): string {
	return `${SHUTDOWN_KEY}#${instanceId}`;
}

export function isShutdownTerminal(job: SystemShutdownEntry | null): boolean {
	return isJobTerminal(job);
}

export function shutdownIdleForMs(job: SystemShutdownEntry | null): number | null {
	return jobIdleForMs(job);
}

/** True when the worker died without recording an outcome — nothing is coming, stop waiting on it. */
export function isShutdownAbandoned(job: SystemShutdownEntry | null): boolean {
	return isJobAbandoned(job, shutdownStaleAfterMs());
}

/**
 * True when a shutdown is genuinely still running: a new stop must be refused and every guarded
 * action must be blocked. Terminal and abandoned rows are leftovers — since nothing ever deletes the
 * row, treating "a row exists" as "busy" would wedge the instance permanently after the first
 * shutdown, and a worker killed mid-run would wedge it with no way back at all.
 */
export function isShutdownBlocking(job: SystemShutdownEntry | null): boolean {
	return isJobBlocking(job, shutdownStaleAfterMs());
}

/** The shutdown job state as the frontend sees it, hung off the instance payload of both status endpoints. */
export type ShutdownState = {
	active: boolean;
	status: string;
	step: string | null;
	progress: number;
	detail: string | null;
	jobID: string | null;
	requestedBy: string | null;
	failureReason: string | null;
	updatedAt: string | null;
	abandoned: boolean;
	idleForMs: number | null;
};

export async function readShutdownJob(instanceId: string): Promise<SystemShutdownEntry | null> {
	const DB = new DynamoDao();
	return (await DB.GetItem(SYSTEM_TABLE, shutdownJobKey(instanceId))) as SystemShutdownEntry | null;
}

/**
 * Compact shutdown state for the status endpoints, or `null` when this instance has never been
 * stopped through the job path.
 *
 * A terminal row is still reported rather than nulled out: the frontend's poller needs to observe
 * the `running` → `completed`/`failed` transition to know how the shutdown ended. `active` is what
 * callers should branch on — never the presence of this object.
 */
export function toShutdownState(job: SystemShutdownEntry | null): ShutdownState | null {
	if (!job) return null;

	return {
		active: isShutdownBlocking(job),
		status: job.status || "unknown",
		step: job.step || null,
		progress: job.progress || 0,
		detail: job.detail || null,
		jobID: job.jobID || null,
		requestedBy: job.requestedBy || null,
		failureReason: job.failureReason || null,
		updatedAt: job.updatedAt || null,
		abandoned: isShutdownAbandoned(job),
		idleForMs: shutdownIdleForMs(job),
	};
}

export async function readShutdownState(instanceId: string): Promise<ShutdownState | null> {
	return toShutdownState(await readShutdownJob(instanceId));
}

/**
 * Payload for the asynchronous shutdown worker leg, discriminated by `requestType` so instance-manager
 * can serve both API Gateway requests and its own self-invokes from one handler.
 */
export type ShutdownRequestData = {
	requestType: "shutdown-request",
	jobID: string,
	instanceID: string,
	requestedBy: string
};

/**
 * Creates the `shutdown#<id>` job row and hands it to the worker. Shared by the interactive stop and
 * the auto-shutoff countdown so both produce an identical job — the caller is only responsible for
 * deciding *whether* to shut down, never for what a shutdown consists of.
 *
 * Callers must have already established that no shutdown is blocking ({@link isShutdownBlocking});
 * this overwrites whatever row is there.
 *
 * @param targetFunctionArn Alias-qualified ARN of instance-manager — `context.invokedFunctionArn`
 * when self-invoking, or the `INSTANCE_MANAGER_FUNCTION_ARN_*` pair cross-lambda. It must carry the
 * alias: an unqualified target resolves to `$LATEST`, whose `ACTIVE_ENV` is whichever branch
 * deployed most recently, and this worker picks its Dynamo tables and its EC2 instance from that.
 * @returns The new job's ID.
 */
export async function queueShutdownJob(
	instanceId: string,
	requestedBy: string,
	targetFunctionArn: string | undefined,
): Promise<string> {
	if (!targetFunctionArn) {
		throw new Error("No instance-manager function ARN configured for the shutdown worker");
	}

	const DB = new DynamoDao();
	const jobKey = shutdownJobKey(instanceId);
	const jobID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const createdAt = new Date().toISOString();

	const job: SystemShutdownEntry = {
		uid: jobKey,
		instanceID: instanceId,
		requestedBy,
		status: "queued",
		step: "queued",
		progress: 0,
		detail: "Shutdown queued",
		createdAt,
		updatedAt: createdAt,
		jobID,
	};
	await DB.PutItem(SYSTEM_TABLE, job);

	try {
		const Lambda = new LambdaDao();
		const payload: ShutdownRequestData = {
			requestType: "shutdown-request",
			jobID,
			instanceID: instanceId,
			requestedBy,
		};
		await Lambda.InvokeFunction(payload, targetFunctionArn);
	} catch (error) {
		// Once the row exists, every path out of here owes the job a terminal status. Anything left
		// on "queued" is a job with no worker behind it, which the UI reports as an active shutdown
		// — and every guard enforces — until the staleness window finally expires.
		const failure: SystemShutdownEntry = {
			status: "failed",
			step: "failed",
			failureReason: "The shutdown could not be started",
			updatedAt: new Date().toISOString(),
		};
		await DB.UpdateItem(SYSTEM_TABLE, jobKey, { updates: failure });
		throw error;
	}

	return jobID;
}

/**
 * Guard for any action that mutates instance or server state. Returns a 409 to return straight back
 * out of the handler when a shutdown is running, or `null` to proceed:
 *
 * ```ts
 * const blocked = await blockIfShutdownInProgress(instanceId);
 * if (blocked) return blocked;
 * ```
 *
 * Returned rather than thrown on purpose — `errorHandler` maps thrown errors to status codes by
 * matching substrings of the message, so a thrown "shutdown in progress" would surface as a 500 and
 * the frontend would have no code to branch on.
 */
export async function blockIfShutdownInProgress(instanceId: string): Promise<APIGatewayProxyResult | null> {
	const job = await readShutdownJob(instanceId);
	if (!isShutdownBlocking(job)) return null;

	return ResponseUtil.Error(
		"This instance is shutting down. Wait for it to finish before making changes.",
		409,
		SHUTDOWN_IN_PROGRESS_CODE,
		{ step: job?.step ?? null, requestedBy: job?.requestedBy ?? null },
	);
}
