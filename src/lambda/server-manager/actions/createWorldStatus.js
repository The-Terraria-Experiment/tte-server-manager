const { successResponse, validationError } = require("../shared/utils/response");
const { getDynamoItem } = require("../shared/utils/dynamo");
const { validateResourceAccess } = require("../shared/utils/permissions");
const { SYSTEM_TABLE } = require("../shared/vars");

function buildJobUid(jobId) {
	return `world-create#${jobId}`;
}

async function handle(event) {
	const instanceId = event.pathParameters?.id;
	const jobId = event.pathParameters?.jobId;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}
	if (!jobId) {
		return validationError("Job ID is required");
	}

	await validateResourceAccess(event, `server::${instanceId}`);

	const jobUid = buildJobUid(jobId);
	const job = await getDynamoItem(SYSTEM_TABLE, jobUid);

	if (!job) {
		return validationError("World creation job not found");
	}

	if (job.instanceId !== instanceId) {
		return validationError("Job does not belong to this instance");
	}

	return successResponse({
		instanceId,
		jobId,
		status: job.status || "unknown",
		step: job.step || null,
		message: job.message || "Waiting for update",
		progress: Number(job.progress || 0),
		error: job.error || null,
		commandId: job.commandId || null,
		uploadCommandId: job.uploadCommandId || null,
		worldFilePath: job.worldFilePath || null,
		s3Key: job.s3Key || null,
		createdAt: job.createdAt || null,
		updatedAt: job.updatedAt || null,
		finishedAt: job.finishedAt || null,
		isDone: ["completed", "failed"].includes(job.status),
	});
}

module.exports = { handle };
