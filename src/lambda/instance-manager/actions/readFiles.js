/**
 * List files in S3 for a specific instance
 */

const {listS3Objects} = require("../shared/utils/aws");
const {successResponse, notFoundError} = require("../shared/utils/response");

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return notFoundError("Instance ID");
	}

	const bucketName = process.env.S3_FILESTORE_NAME;

	if (!bucketName) {
		throw new Error("S3_FILESTORE_NAME environment variable not set");
	}

	// Use instance ID as prefix to namespace files per instance
	const prefix = `${instanceId}/`;
	const files = await listS3Objects(bucketName, prefix);

	return successResponse({ files });
}

module.exports = {handle};
