/**
 * Write the new config file to S3 and initiate sync
 */

const {FUNC_NAMES} = require("../shared/constants");
const {logAction} = require("../shared/utils/cloudwatchLogger");
const {validateResourceAccess} = require("../shared/utils/permissions");
const {successResponse, validationError, errorResponse} = require("../shared/utils/response");
const {executeSSMCommand, getSignedDownloadUrl, putJsonObject} = require("../shared/utils/aws");

/**
 * Sync files from S3 to instance
 * Lists all files for the instance in S3 and downloads them
 * @param {string} instanceId - EC2 instance ID
 * @param {string} s3Bucket - S3 bucket name
 * @param {string} baseLocalPath - Base directory on instance (default: /opt/terraria)
 * @returns {Promise<{commandId: string, filesProcessed: number}>}
 */
async function syncConfigToInstance(instanceId, s3Bucket, baseLocalPath) {
	if (!instanceId) {
		throw new Error('instanceId is required');
	}
	if (!s3Bucket) {
		throw new Error('s3Bucket is required');
	}
	if (!baseLocalPath) {
		throw new Error('baseLocalPath is required');
	}

	// Build shell script to download each file
	const commands = [];
	
	// Start with error handling and setup
	commands.push('#!/bin/bash');
	commands.push('set -e');
	commands.push('');
	commands.push('echo "Starting file sync from S3"');
	commands.push('');

	// Extract the filepath from the key (remove instanceId prefix)
	const filepath = `${instanceId}/config.json`;
	const localPath = `${baseLocalPath}/${filepath}`;
	const dirPath = localPath.substring(0, localPath.lastIndexOf('/'));

	// Generate pre-signed URL for download (1 hour expiry)
	const presignedUrl = await getSignedDownloadUrl(s3Bucket, `inst#${filepath}`, 3600);

	// Create directory and download file, overwriting if it exists
	commands.push(`echo "Downloading ${filepath} to ${localPath}"`);
	commands.push(`mkdir -p "${dirPath}"`);
	commands.push(`chown ubuntu:ubuntu "${dirPath}"`);
	commands.push(`chmod 755 "${dirPath}"`);
	commands.push(`curl --silent --fail --location -o "${localPath}" "${presignedUrl}"`);
	commands.push(`if [ $? -eq 0 ]; then`);
	commands.push(`  chown ubuntu:ubuntu "${localPath}"`);
	commands.push(`  chmod 644 "${localPath}"`);
	commands.push(`  echo "Successfully downloaded ${filepath}"`);
	commands.push(`else`);
	commands.push(`  echo "Failed to download ${filepath}" >&2`);
	commands.push(`  exit 1`);
	commands.push(`fi`);
	commands.push('');

	commands.push(`echo "Completed config file sync"`);

	// Execute SSM command
	const {commandId} = await executeSSMCommand(instanceId, commands);

	return {
		commandId,
	};
}


async function handle(event) {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return validationError("Server ID is required");
	}

	await validateResourceAccess(event, `server::${serverId}`);

	let configBody;
	try {
		configBody = JSON.parse(event.body.config || "{}");
	} catch (err) {
		return validationError("Request body must be valid JSON");
	}

	if (!configBody || typeof configBody !== 'object' || Array.isArray(configBody)) {
		return validationError("Config payload must be a JSON object");
	}

	const bucket = process.env.S3_CONFIG_BUCKET_NAME;
	if (!bucket) {
		throw new Error('S3_CONFIG_BUCKET_NAME env var not set');
	}

	const baseLocalPath = process.env.BASE_ROOT;
	if (!baseLocalPath) {
		throw new Error('BASE_ROOT env var not set');
	}

	const s3Key = `inst#${serverId}/config.json`;

	try {
		await putJsonObject(bucket, s3Key, configBody, 2);

		const {commandId} = await syncConfigToInstance(serverId, bucket, baseLocalPath);

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
			action: "write-config",
			status: 'ok',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { s3Key, bucket, commandId }
		});

		return successResponse({
			message: "Config updated and sync started",
			commandId,
			s3Key,
		});
	} catch (err) {
		return errorResponse(err.message || 'Failed to write config');
	}
}

module.exports = {handle};
