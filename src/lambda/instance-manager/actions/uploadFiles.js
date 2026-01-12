/**
 * Generate pre-signed URLs for S3 file uploads
 * Client uploads files directly to S3 using these URLs (bypasses 10MB API Gateway limit)
 */

const { FUNC_NAMES } = require("../shared/constants");
const {getSignedUploadUrl} = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const {getDynamoItem} = require("../shared/utils/dynamo");
const {successResponse, validationError} = require("../shared/utils/response");

async function handle(event) {
	const instanceId = event.pathParameters?.id;
	const bucketName = process.env.S3_FILESTORE_NAME;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	if (!bucketName) {
		return validationError("S3 bucket not configured");
	}

	const instanceData = await getDynamoItem(process.env.INSTANCE_TABLE_NAME, `inst#${instanceId}`);
	const allowedPaths = new Set(Object.values(instanceData?.validRoots || {}));

	// Parse request body for upload request
	let body;
	try {
		body = JSON.parse(event.body || "{}");
	} catch (e) {
		return validationError("Request body must be valid JSON");
	}

	const {pathRoot, path, fileName} = body;

	if (!pathRoot) {
		return validationError("pathRoot parameter is required");
	}

	if (!fileName) {
		return validationError("fileName parameter is required");
	}

	// Validate pathRoot against allowed paths
	if (!allowedPaths.has(pathRoot)) {
		return validationError(`Invalid pathRoot`);
	}

	try {
		// Build S3 path: {instanceID}/{pathRoot}/{path}/{fileName}
		const pathComponents = [instanceId, pathRoot.slice(1)];
		if (path) {
			pathComponents.push(path);
		}
		pathComponents.push(fileName);
		const s3Key = pathComponents.join("/");

		// Generate pre-signed URL valid for 1 hour
		const uploadUrl = await getSignedUploadUrl(bucketName, s3Key, 3600);

		logAction(FUNC_NAMES.INST_MGR, {
			userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
			action: "upload-files",
			status: 'ok',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { path, fileName, pathRoot, instanceId, s3Key }
		});

		return successResponse({
			message: "Pre-signed upload URL generated",
			uploadUrl,
			s3Key,
			instanceId,
			pathRoot,
			path,
			fileName,
			expiresIn: 3600,
		});
	} catch (error) {
		console.error("Error generating pre-signed URL:", error);
		return validationError(`Failed to generate upload URL: ${error.message}`);
	}
}

module.exports = {handle};
