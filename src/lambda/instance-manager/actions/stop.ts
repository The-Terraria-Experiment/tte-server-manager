import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import type { SystemShutdownEntry } from "../shared/schema/SystemTable.js";
import type { UserDataEntry } from "../shared/schema/UserTable.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import {
	isShutdownBlocking,
	queueShutdownJob,
	shutdownIdleForMs,
	shutdownJobKey,
	SHUTDOWN_IN_PROGRESS_CODE,
} from "../shared/utils/ShutdownJob.js";
import { PERM_TABLE, SYSTEM_TABLE } from "../shared/vars.js";

const EC2 = new Ec2Dao();

/**
 * Queues a shutdown and returns immediately.
 *
 * This used to run the whole shutdown sequence inline, which meant every task it did had to fit
 * inside API Gateway's 29s integration timeout — with the syncs sharing one ~25s pot and no room to
 * add anything. The work now happens on an asynchronously-invoked worker (see shutdownWorker) whose
 * only record is the `shutdown#<id>` row, and this handler's job is to create that row and hand off.
 */
export const stop = async (event: AuthorizedEvent, context: Context) => {
	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const DB = new DynamoDao();
	const jobKey = shutdownJobKey(instanceId);

	// Refuse only while a shutdown is genuinely still running. Nothing ever deletes this row, so
	// treating its mere existence as "busy" would wedge the instance after its first stop; a worker
	// killed mid-run never writes a terminal status, so overwriting a stale row is the only recovery.
	const existingJob = (await DB.GetItem(SYSTEM_TABLE, jobKey)) as SystemShutdownEntry | null;
	if (isShutdownBlocking(existingJob)) {
		return ResponseUtil.Error("A shutdown is already in progress for this instance", 409, SHUTDOWN_IN_PROGRESS_CODE, {
			step: existingJob?.step ?? null,
			requestedBy: existingJob?.requestedBy ?? null,
		});
	}

	const instanceStatus = await EC2.GetInstanceStatus(instanceId);
	if (instanceStatus.state === InstanceState.STOPPED || instanceStatus.state === InstanceState.STOPPING) {
		return ResponseUtil.Success({
			message: "Instance is already stopping or stopped",
			instanceId,
			alreadyStopped: true,
		});
	}

	if (existingJob) {
		CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "stop",
			status: "replacing-stale-job",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: {
				replacedJobID: existingJob.jobID,
				replacedStatus: existingJob.status,
				replacedStep: existingJob.step,
				replacedUpdatedAt: existingJob.updatedAt,
				idleForMs: shutdownIdleForMs(existingJob),
				instanceId,
			},
		});
	}

	const requestedBy = Parsers.GetUserSub(event);
	const requestedByData = (await DB.GetItem(PERM_TABLE, `user#${requestedBy}`)) as UserDataEntry | null;

	let jobID: string;
	try {
		// Self-invoke targeted at the alias this request arrived on, so the worker runs against the
		// same environment. See queueShutdownJob for why the default target is not safe here.
		jobID = await queueShutdownJob(instanceId, requestedByData?.displayName || "unknown", context.invokedFunctionArn);
	} catch (error) {
		await CWLogger.Error(FUNC_NAMES.INST_MGR, {
			userId: requestedBy,
			action: "stop",
			error: error instanceof Error ? error.message : String(error),
			details: { instanceId },
		});
		throw error;
	}

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: requestedBy,
		action: "stop",
		status: "queued",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, jobID },
	});

	return ResponseUtil.Success({
		message: "Instance shutdown started",
		instanceId,
		jobID,
		status: "queued",
	});
};
