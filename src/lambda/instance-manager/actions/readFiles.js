/**
 * List files in S3 for a specific instance
 */

const { validateResourceAccess, getUserSub } = require("../shared/utils/permissions");
const { FUNC_NAMES } = require("../shared/constants");
const {listS3Objects} = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { getDynamoItem } = require("../shared/utils/dynamo");
const {successResponse, notFoundError} = require("../shared/utils/response");

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return notFoundError("Instance ID");
	}

	await validateResourceAccess(event, `instance::${instanceId}`);

	const bucketName = process.env.S3_FILESTORE_NAME;

	if (!bucketName) {
		throw new Error("S3_FILESTORE_NAME environment variable not set");
	}

	// Use instance ID as prefix to namespace files per instance
	const prefix = `${instanceId}/`;
	const files = await listS3Objects(bucketName, prefix);

	const instanceData = await getDynamoItem(process.env.INSTANCE_TABLE_NAME, `inst#${instanceId}`);
	const pathRoots = instanceData?.validRoots || [];
	const worldPaths = instanceData?.worldPaths || [];

	logAction(FUNC_NAMES.INST_MGR, {
		userId: getUserSub(event) ?? 'unknown',
		action: "read-files",
		status: 'ok',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { files, pathRoots, worldPaths }
	});

	return successResponse({ files, pathRoots, worldPaths });
}

module.exports = {handle};
