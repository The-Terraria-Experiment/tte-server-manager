/**
 * Delete files from s3 and the instance
 */

const { FUNC_NAMES } = require("../shared/constants");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { validateResourceAccess } = require("../shared/utils/permissions");
const {getDynamoItem} = require("../shared/utils/dynamo");
const { successResponse, validationError } = require("../shared/utils/response");
const { deleteS3Object, deleteS3Folder, executeSSMCommand, getSSMCommandResult } = require("../shared/utils/aws");

/**
 * Delete file or folder from EC2 instance via SSM
 * @param {string} instanceId - EC2 instance ID
 * @param {string} localPath - Full path to file or folder on instance
 * @returns {Promise<{commandId: string, status: string}>}
 */
async function deleteFileFromInstance(instanceId, localPath) {
	if (!instanceId) {
		throw new Error('instanceId is required');
	}
	if (!localPath) {
		throw new Error('localPath is required');
	}

	const commands = [];
	commands.push('#!/bin/bash');
	commands.push('set -e');
	commands.push('');
	commands.push(`echo "Deleting: ${localPath}"`);
	commands.push(`if [ -e "${localPath}" ]; then`);
	commands.push(`  rm -rf "${localPath}"`);
	commands.push(`  echo "Successfully deleted ${localPath}"`);
	commands.push(`else`);
	commands.push(`  echo "Path not found: ${localPath}"`);
	commands.push(`fi`);

	const {commandId} = await executeSSMCommand(instanceId, commands);

	return {
		commandId,
		status: 'pending',
	};
}

async function handle(event) {
	const instanceId = event.pathParameters?.id;
	const bucketName = process.env.S3_FILESTORE_NAME;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	if (!bucketName) {
		return validationError("S3 bucket not configured");
	}

	await validateResourceAccess(event, `instance::${instanceId}`);

	const instanceData = await getDynamoItem(process.env.INSTANCE_TABLE_NAME, `inst#${instanceId}`);
	const allowedPaths = new Set(Object.values(instanceData?.validRoots || {}));

	// Parse request body for upload request
	let body;
	try {
		body = JSON.parse(event.body || "{}");
	} catch (e) {
		return validationError("Request body must be valid JSON");
	}

	const {pathRoot, path, fileName, isFolder} = body;

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

		// Delete from S3
		if (isFolder) {
			await deleteS3Folder(bucketName, s3Key);
		} else {
			await deleteS3Object(bucketName, s3Key);
		}

		// Delete from instance
		const baseLocalPath = process.env.BASE_ROOT;
		const filepath = `${pathRoot.slice(1)}${path ? '/' + path : ''}/${fileName}`;
		const localPath = `${baseLocalPath}/${filepath}`;
		const result = await deleteFileFromInstance(instanceId, localPath);

		logAction(FUNC_NAMES.INST_MGR, {
			userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
			action: "delete-file",
			status: 'ok',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { pathRoot, path, fileName, commandId: result.commandId }
		});

		return successResponse({ commandId: result.commandId, s3Key });
	} catch (error) {
		console.error('Delete file error:', error);
		throw error;
	}
}

module.exports = {handle};
