/**
 * File sync handler - Downloads files from S3 to EC2 instance
 * S3 object keys are formatted as: <instanceId>/<filepath>
 * Example: i-0123456789abcdef/config/serverconfig.txt
 * 
 * Lists all files in S3 for the instance and syncs only those that don't already exist
 * on the instance, avoiding unnecessary re-downloads
 */

const {executeSSMCommand, listS3Objects, getSignedDownloadUrl} = require('../shared/utils/aws');
const {successResponse} = require('../shared/utils/response');

/**
 * Sync files from S3 to instance
 * Lists all files for the instance in S3 and downloads them
 * @param {string} instanceId - EC2 instance ID
 * @param {string} s3Bucket - S3 bucket name
 * @param {string} baseLocalPath - Base directory on instance (default: /opt/terraria)
 * @returns {Promise<{commandId: string, filesProcessed: number}>}
 */
async function syncFilesToInstance(instanceId, s3Bucket, baseLocalPath = '/opt/terraria') {
	if (!instanceId) {
		throw new Error('instanceId is required');
	}
	if (!s3Bucket) {
		throw new Error('s3Bucket is required');
	}

	// List all objects in S3 for this instance
	const s3Objects = await listS3Objects(s3Bucket, `${instanceId}/`);
	
	if (s3Objects.length === 0) {
		throw new Error(`No files found in S3 for instance ${instanceId}`);
	}

	const s3Keys = s3Objects.map(obj => obj.key);

	// Build shell script to download each file
	const commands = [];
	
	// Start with error handling and setup
	commands.push('#!/bin/bash');
	commands.push('set -e');
	commands.push('');
	commands.push('echo "Starting file sync from S3"');
	commands.push('');

	// Process each file
	for (const s3Key of s3Keys) {
		// Extract the filepath from the key (remove instanceId prefix)
		const filepath = s3Key.substring(instanceId.length + 1); // +1 for the slash
		const localPath = `${baseLocalPath}/${filepath}`;
		const dirPath = localPath.substring(0, localPath.lastIndexOf('/'));

		// Generate pre-signed URL for download (1 hour expiry)
		const presignedUrl = await getSignedDownloadUrl(s3Bucket, s3Key, 3600);

		// Create directory and download file using curl only if it doesn't exist
		commands.push(`echo "Checking ${s3Key}"`);
		commands.push(`if [ ! -f "${localPath}" ]; then`);
		commands.push(`  echo "Downloading ${s3Key} to ${localPath}"`);
		commands.push(`  mkdir -p "${dirPath}"`);
		commands.push(`  curl -o "${localPath}" "${presignedUrl}"`);
		commands.push(`else`);
		commands.push(`  echo "File already exists, skipping: ${localPath}"`);
		commands.push(`fi`);
		commands.push('');
	}

	commands.push(`echo "Completed file sync (${s3Keys.length} file(s) checked)"`);

	// Execute SSM command
	const {commandId} = await executeSSMCommand(instanceId, commands);

	return {
		commandId,
		filesProcessed: s3Keys.length,
	};
}

/**
 * Handler for file sync operations
 * Lists all files in S3 for the instance and syncs them to the EC2 instance
 * @param {Object} event
 * @param {Object} event.pathParameters
 * @param {string} event.pathParameters.id - Instance ID
 * @returns {Promise<Response>}
 */
async function handle(event) {
	try {
		const instanceId = event.pathParameters?.id;
		const baseLocalPath = process.env.BASE_ROOT;

		if (!instanceId) {
			throw new Error('Instance ID is required');
		}

		// Use environment variable for bucket
		const bucket = process.env.S3_FILESTORE_NAME;
		if (!bucket) {
			throw new Error('S3_FILESTORE_NAME env var not set');
		}

		const result = await syncFilesToInstance(instanceId, bucket, baseLocalPath);

		return successResponse({
			message: 'File sync initiated successfully',
			commandId: result.commandId,
			filesProcessed: result.filesProcessed,
		});
	} catch (error) {
		console.error('File sync error:', error);
		throw error;
	}
}

module.exports = {
	handle,
	syncFilesToInstance,
};
