import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { SYSTEM_TABLE, WORLD_CREATE_KEY } from "../shared/vars.js";
import type { SystemWorldCreateEntry } from "../shared/schema/SystemTable.js";
import { isWorldgenAbandoned, isWorldgenTerminal, worldgenIdleForMs } from "../shared/utils/jobs/WorldgenJob.js";

export const getWorldgenStatus = async (event: AuthorizedEvent, context: Context) => {
	const instanceID = event.pathParameters?.id;
	const jobID = event.pathParameters?.jobId;

	if (!instanceID) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}
	if (!jobID) {
		return ResponseUtil.ValidationError("Job ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${instanceID}`);

	const DB = new DynamoDao();

	const jobStatus = await DB.GetItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${instanceID}`) as SystemWorldCreateEntry;

	if (!jobStatus) {
		return ResponseUtil.Success({
			instanceID,
			found: false,
		});
	}

	if (jobStatus.instanceID && (jobStatus.instanceID !== instanceID)) {
		return ResponseUtil.ValidationError("Job owner mismatch");
	}

	// A job whose worker died mid-run keeps whatever status it had when the invocation was killed, so
	// "running" alone can't tell a client whether to keep waiting. `abandoned` is that missing bit:
	// nothing is coming, stop polling and say so. It also mirrors exactly what queueCreateWorld will
	// let the user overwrite, so the UI never offers a retry the API would then refuse (or vice versa).
	const abandoned = isWorldgenAbandoned(jobStatus);

	return ResponseUtil.Success({
		instanceID,
		jobID: jobStatus.jobID,
		status: jobStatus.status || "unknown",
		step: jobStatus.step || null,
		progress: jobStatus.progress || 0,
		detail: jobStatus.detail || null,
		failureReason: jobStatus.failureReason || null,
		createdAt: jobStatus.createdAt || null,
		updatedAt: jobStatus.updatedAt || null,
		requestedBy: jobStatus.requestedBy || null,
		abandoned,
		idleForMs: worldgenIdleForMs(jobStatus),
		isDone: isWorldgenTerminal(jobStatus) || abandoned
	});
};
