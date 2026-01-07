/**
 * Generate pre-signed URLs for S3 file uploads
 * Client uploads files directly to S3 using these URLs (bypasses 10MB API Gateway limit)
 */

const {getSignedUploadUrl} = require("../shared/utils/aws");
const {successResponse, validationError} = require("../shared/utils/response");

async function handle(event) {
	const instanceId = event.pathParameters?.id;
	const bucketName = process.env.S3_FILESTORE_NAME;
	const allowedPaths = JSON.parse(process.env.VALID_PATH_ROOTS || "[]");

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	if (!bucketName) {
		return validationError("S3 bucket not configured");
	}

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
	if (!allowedPaths.includes(pathRoot)) {
		return validationError(`Invalid pathRoot. Allowed paths: ${allowedPaths.join(", ")}`);
	}

	try {
		// Build S3 path: {instanceID}/{pathRoot}/{path}/{fileName}
		const pathComponents = [instanceId, pathRoot];
		if (path) {
			pathComponents.push(path);
		}
		pathComponents.push(fileName);
		const s3Key = pathComponents.join("/");

		// Generate pre-signed URL valid for 1 hour
		const uploadUrl = await getSignedUploadUrl(bucketName, s3Key, 3600);

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
