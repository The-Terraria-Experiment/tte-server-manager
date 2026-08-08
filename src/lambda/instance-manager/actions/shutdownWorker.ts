import type { Context } from "aws-lambda";
import type { SystemShutdownEntry } from "../shared/schema/SystemTable.js";
import type { ShutdownRequestData } from "../shared/utils/jobs/ShutdownJob.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { CleanupUtil } from "../shared/utils/jobs/Cleanup.js";
import { boundedWaitDeadline } from "../shared/utils/jobs/SyncBudget.js";
import { shutdownJobKey } from "../shared/utils/jobs/ShutdownJob.js";
import {
	SHUTDOWN_STEP_COMPLETED,
	SHUTDOWN_STEP_STOPPING,
	SHUTDOWN_TASKS,
	taskProgress,
} from "../shared/utils/jobs/ShutdownTasks.js";
import { SYSTEM_TABLE } from "../shared/vars.js";

/**
 * Wall-clock kept back from the task phase for what has to happen after it: the EC2 stop, the
 * worldgen cleanup, the terminal row write, and the CloudWatch flush. The stop is issued *after* the
 * tasks (SSM can't reach a box that's powering off), so a task phase that eats the whole invocation
 * leaves the instance running with a job row claiming it stopped.
 */
const POST_TASK_RESERVE_MS = 15000;

const EC2 = new Ec2Dao();

/**
 * Runs the shutdown sequence for one instance, then stops it.
 *
 * Invoked asynchronously by `stop` (interactive) and by auto-shutoff-manager (unattended), so both
 * paths run the identical task list — previously each had its own inline copy on its own timeout
 * budget, and the unattended one had the tighter of the two.
 */
export const shutdownWorker = async (event: ShutdownRequestData, context: Context) => {
	const { instanceID, jobID, requestedBy } = event;
	const DB = new DynamoDao();
	const jobKey = shutdownJobKey(instanceID);

	// Async invocation means lambda retries this worker on its own, up to twice, with no way to opt
	// out per-invocation. The claim is what makes those retries no-ops: without it a retry re-runs
	// the whole task list — and a second EC2 stop — against a box that is already powering off.
	const claimedAt = new Date().toISOString();
	const claim = await DB.UpdateItem(SYSTEM_TABLE, jobKey, {
		UpdateExpression: "SET #workerStartedAt = :now, #updatedAt = :now",
		ExpressionAttributeNames: { "#workerStartedAt": "workerStartedAt", "#updatedAt": "updatedAt" },
		ExpressionAttributeValues: { ":now": claimedAt, ":jid": jobID },
		ConditionExpression: "attribute_exists(uid) AND jobID = :jid AND attribute_not_exists(workerStartedAt)",
	});
	if (!claim) {
		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: requestedBy,
			action: "shutdown-worker",
			status: "already-claimed",
			details: { instanceID, jobID },
		});
		return ResponseUtil.Success({ message: "Shutdown already claimed by an earlier worker", instanceID, jobID });
	}

	const taskOutcomes: Record<string, string> = {};
	const taskPhaseDeadline = boundedWaitDeadline(context, POST_TASK_RESERVE_MS);

	for (const [index, task] of SHUTDOWN_TASKS.entries()) {
		const progressUpdate: SystemShutdownEntry = {
			status: "running",
			step: task.id,
			progress: taskProgress(index),
			detail: task.label,
			updatedAt: new Date().toISOString(),
		};
		await DB.UpdateItem(SYSTEM_TABLE, jobKey, { updates: progressUpdate });

		// Each task is capped on its own so one stuck task can't consume what's left for the rest,
		// and the phase deadline stops the whole list before the invocation runs out either way.
		const deadline = Math.min(taskPhaseDeadline, Date.now() + task.maxMs);

		try {
			await task.run(instanceID, deadline);
			taskOutcomes[task.id] = "ok";
		} catch (error) {
			// Tasks are meant to swallow their own failures; if one throws anyway it still must not
			// stop the shutdown. The instance is going down regardless — the outcome map is what
			// turns that from silent into diagnosable.
			const reason = error instanceof Error ? error.message : String(error);
			taskOutcomes[task.id] = `failed: ${reason}`;

			await CWLogger.Error(FUNC_NAMES.INST_MGR, {
				userId: requestedBy,
				action: "shutdown-worker",
				error: reason,
				details: { instanceID, jobID, task: task.id },
			});
		}
	}

	try {
		const stoppingUpdate: SystemShutdownEntry = {
			status: "running",
			step: SHUTDOWN_STEP_STOPPING,
			progress: 85,
			detail: "Stopping instance",
			updatedAt: new Date().toISOString(),
		};
		await DB.UpdateItem(SYSTEM_TABLE, jobKey, { updates: stoppingUpdate });

		await EC2.StopInstance(instanceID);
		await CleanupUtil.ClearWorldCreationStatus(instanceID);

		const done: SystemShutdownEntry = {
			status: "completed",
			step: SHUTDOWN_STEP_COMPLETED,
			progress: 100,
			detail: "Shutdown complete",
			taskOutcomes,
			updatedAt: new Date().toISOString(),
		};
		await DB.UpdateItem(SYSTEM_TABLE, jobKey, { updates: done });

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: requestedBy,
			action: "shutdown-worker",
			status: "completed",
			resource: instanceID,
			details: { instanceID, jobID, taskOutcomes },
		});

		return ResponseUtil.Success({ message: "Instance stopping", instanceID, jobID, taskOutcomes });
	} catch (error) {
		const failureReason = error instanceof Error ? error.message : String(error);

		const failure: SystemShutdownEntry = {
			status: "failed",
			step: "failed",
			failureReason: "The instance could not be stopped",
			taskOutcomes,
			updatedAt: new Date().toISOString(),
		};
		await DB.UpdateItem(SYSTEM_TABLE, jobKey, { updates: failure });

		await CWLogger.Error(FUNC_NAMES.INST_MGR, {
			userId: requestedBy,
			action: "shutdown-worker",
			error: failureReason,
			details: { instanceID, jobID, taskOutcomes },
		});

		// Returned, not rethrown: this worker is invoked asynchronously, so a throw would have lambda
		// retry it — and the claim above would make that retry a no-op anyway, leaving the job
		// recorded as failed either way. Rethrowing would only add noise.
		return ResponseUtil.Error(failureReason);
	}
};
