import type { APIGatewayProxyResult } from "aws-lambda";
import type { InstanceTmlUpdateEntry } from "../../schema/InstanceTable.js";
import { DynamoDao } from "../../aws/DynamoDB.js";
import { LambdaDao } from "../../aws/Lambda.js";
import { Assert } from "../core/Assert.js";
import { ResponseUtil } from "../core/APIResponse.js";
import { isJobAbandoned, isJobBlocking } from "./AsyncJob.js";

/**
 * The per-instance tModLoader update job (`tmlupdate#<instanceID>`).
 *
 * The row is in the **instance** table, not the system table like shutdown and worldgen, because the
 * thing being updated is the box. The fleet is shared by prod and stage while the system tables are
 * per environment, so a job recorded in one would be invisible to the other's guards. A stage
 * operator could then launch a world halfway through a prod operator's install.
 *
 * Like `shutdown#`, the row is never deleted. Liveness is {@link isTmlUpdateBlocking}, and the next
 * job overwrites a terminal or abandoned row. `InstanceRegistry` only scans `inst#` rows, so this
 * prefix is invisible to it.
 */

export const TML_UPDATE_KEY = "tmlupdate";
export const TML_UPDATE_IN_PROGRESS_CODE = "TML_UPDATE_IN_PROGRESS";

/**
 * The worker heartbeats between steps, and its longest step (the on-box install) is bounded by the
 * function's own timeout (300s). Anything quiet for longer than that can't still have a live worker.
 */
const STALE_MS = 6 * 60 * 1000;

export const tmlUpdateJobKey = (instanceId: string): string => `${TML_UPDATE_KEY}#${instanceId}`;

function tableName(): string {
	const table = process.env.INSTANCE_TABLE_NAME;
	Assert.IsTruthyString(table, "INSTANCE_TABLE_NAME environment variable is required");
	return table as string;
}

export async function readTmlUpdateJob(instanceId: string): Promise<InstanceTmlUpdateEntry | null> {
	return (await new DynamoDao().GetItem(tableName(), tmlUpdateJobKey(instanceId))) as InstanceTmlUpdateEntry | null;
}

export function isTmlUpdateBlocking(job: InstanceTmlUpdateEntry | null): boolean {
	return isJobBlocking(job, STALE_MS);
}

export type TmlUpdateState = {
	active: boolean,
	abandoned: boolean,
	status: string,
	step: string | null,
	progress: number,
	detail: string | null,
	result: string | null,
	targetVersion: string | null,
	fromVersion: string | null,
	requestedBy: string | null,
	failureReason: string | null,
	updatedAt: string | null,
};

/** The job as the frontend sees it. A terminal row is still reported so the tile can show how it ended. */
export function toTmlUpdateState(job: InstanceTmlUpdateEntry | null): TmlUpdateState | null {
	if (!job) return null;
	return {
		active: isTmlUpdateBlocking(job),
		abandoned: isJobAbandoned(job, STALE_MS),
		status: job.status || "unknown",
		step: job.step || null,
		progress: job.progress || 0,
		detail: job.detail || null,
		result: job.result || null,
		targetVersion: job.targetVersion || null,
		fromVersion: job.fromVersion || null,
		requestedBy: job.requestedBy || null,
		failureReason: job.failureReason || null,
		updatedAt: job.updatedAt || null,
	};
}

/**
 * Advances the job. There's deliberately no realtime event. The only people watching are sysadmins
 * with the tile open, it polls while a job is active, and a new event type means mirroring it across
 * two files for a feature used a few times a month.
 */
export async function writeTmlUpdateProgress(instanceId: string, updates: InstanceTmlUpdateEntry): Promise<void> {
	await new DynamoDao().UpdateItem(tableName(), tmlUpdateJobKey(instanceId), {
		updates: { ...updates, updatedAt: new Date().toISOString() },
	});
}

/** Payload for the self-invoked worker leg, discriminated on `requestType` like the shutdown worker. */
export type TmlUpdateRequestData = {
	requestType: "tml-update-request",
	jobID: string,
	instanceID: string,
	requestedBy: string,
};

/**
 * Creates the job row and hands it to the worker. Callers must already have established that nothing
 * is blocking. This overwrites the row.
 *
 * @param targetFunctionArn Alias-qualified, `context.invokedFunctionArn`. See the alias gotcha in CLAUDE.md.
 */
export async function queueTmlUpdateJob(instanceId: string, requestedBy: string, targetFunctionArn: string): Promise<string> {
	const jobID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const now = new Date().toISOString();

	const job: InstanceTmlUpdateEntry = {
		uid: tmlUpdateJobKey(instanceId),
		instanceID: instanceId,
		jobID,
		requestedBy,
		status: "queued",
		step: "queued",
		progress: 0,
		detail: "Update queued",
		createdAt: now,
		updatedAt: now,
	};
	await new DynamoDao().PutItem(tableName(), job);

	try {
		const payload: TmlUpdateRequestData = { requestType: "tml-update-request", jobID, instanceID: instanceId, requestedBy };
		await new LambdaDao().InvokeFunction(payload, targetFunctionArn);
	} catch (error) {
		// A queued row with no worker behind it would block launches until it went stale.
		await writeTmlUpdateProgress(instanceId, {
			status: "failed",
			step: "failed",
			failureReason: "The update could not be started",
		});
		throw error;
	}

	return jobID;
}

/**
 * Guard for anything that would start a game server, or take the box away, while tModLoader is being
 * replaced underneath it. Returned, not thrown, for the same reason as `blockIfShutdownInProgress`.
 *
 * The installer only touches the live install in its last two renames, so the window this protects
 * is small. It is also the one where a launch would load half of one release and half of another.
 */
export async function blockIfTmlUpdateInProgress(instanceId: string): Promise<APIGatewayProxyResult | null> {
	// Only tModLoader boxes ever have a row, so for TShock this is one GetItem that finds nothing.
	const job = await readTmlUpdateJob(instanceId);
	if (!isTmlUpdateBlocking(job)) return null;

	return ResponseUtil.Error(
		"tModLoader is being updated on this instance. Wait for the update to finish.",
		409,
		TML_UPDATE_IN_PROGRESS_CODE,
		{ step: job?.step ?? null, requestedBy: job?.requestedBy ?? null },
	);
}
