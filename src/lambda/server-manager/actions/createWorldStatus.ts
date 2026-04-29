import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { SYSTEM_TABLE, WORLD_CREATE_KEY } from "../shared/vars.js";
import type { SystemWorldCreateEntry } from "../shared/schema/SystemTable.js";

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

	const jobStatus = DB.GetItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${instanceID}`) as SystemWorldCreateEntry;

	if (!jobStatus) {
		return ResponseUtil.NotFoundError("World Creation Job");
	}

	if (jobStatus.instanceID !== instanceID) {
		return ResponseUtil.ValidationError("Job owner mismatch");
	}

	return ResponseUtil.Success({
		instanceID,
		jobID: jobStatus.jobID,
		status: jobStatus.status || "unknown",
		step: jobStatus.step || null,
		progress: jobStatus.progress || 0,
		createdAt: jobStatus.createdAt || null,
		updatedAt: jobStatus.updatedAt || null,
		isDone: ["completed", "failed"].includes(jobStatus.status || "")
	});
};
