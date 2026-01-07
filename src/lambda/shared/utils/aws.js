/**
 * AWS SDK helper utilities
 * Centralized AWS service interactions (EC2, S3, SSM, Secrets Manager, etc.)
 */

const {EC2Client, StartInstancesCommand, StopInstancesCommand, RebootInstancesCommand, DescribeInstancesCommand} = require("@aws-sdk/client-ec2");
const {SSMClient, SendCommandCommand} = require("@aws-sdk/client-ssm");
const {SecretsManagerClient, GetSecretValueCommand} = require("@aws-sdk/client-secrets-manager");
const {S3Client, ListObjectsV2Command, PutObjectCommand} = require("@aws-sdk/client-s3");
const {getSignedUrl} = require("@aws-sdk/s3-request-presigner");

const ec2Client = new EC2Client({region: process.env.AWS_REGION});
const ssmClient = new SSMClient({region: process.env.AWS_REGION});
const secretsClient = new SecretsManagerClient({region: process.env.AWS_REGION});
const s3Client = new S3Client({region: process.env.AWS_REGION});

/**
 * Get EC2 instance status
 * @param {string} instanceId
 * @returns {Promise<{state: string, publicIp: string, launchTime: string, instanceType: string, name: string}>}
 */
async function getInstanceStatus(instanceId) {
	const command = new DescribeInstancesCommand({
		InstanceIds: [instanceId],
	});
	const response = await ec2Client.send(command);

	if (!response.Reservations || response.Reservations.length === 0) {
		throw new Error(`Instance ${instanceId} not found`);
	}

	const instance = response.Reservations[0].Instances[0];
	const nameTag = instance.Tags?.find(tag => tag.Key === 'Name');
	return {
		state: instance.State.Name, // pending | running | shutting-down | terminated | stopping | stopped
		publicIp: instance.PublicIpAddress || "PENDING",
		launchTime: instance.LaunchTime,
		instanceType: instance.InstanceType,
		name: nameTag?.Value || '(Unnamed)',
	};
}

/**
 * Get status for multiple EC2 instances in a single API call (optimized for listing)
 * @param {string[]} instanceIds
 * @returns {Promise<Array<{id: string, state: string, publicIp: string, launchTime: string, instanceType: string, name: string}>>}
 */
async function getMultipleInstanceStatus(instanceIds) {
	if (!instanceIds || instanceIds.length === 0) {
		return [];
	}

	const command = new DescribeInstancesCommand({
		InstanceIds: instanceIds,
	});
	const response = await ec2Client.send(command);

	const instances = [];
	for (const reservation of response.Reservations || []) {
		for (const instance of reservation.Instances || []) {
			const nameTag = instance.Tags?.find(tag => tag.Key === 'Name');
			instances.push({
				id: instance.InstanceId,
				state: instance.State.Name,
				publicIp: instance.PublicIpAddress || "PENDING",
				launchTime: instance.LaunchTime,
				instanceType: instance.InstanceType,
				name: nameTag?.Value || '(Unnamed)',
			});
		}
	}

	return instances;
}

/**
 * Start EC2 instance
 * @param {string} instanceId
 * @returns {Promise<{state: string}>}
 */
async function startInstance(instanceId) {
	const command = new StartInstancesCommand({
		InstanceIds: [instanceId],
	});
	const response = await ec2Client.send(command);
	const instance = response.StartingInstances[0];
	return {
		state: instance.CurrentState.Name,
	};
}

/**
 * Stop EC2 instance
 * @param {string} instanceId
 * @returns {Promise<{state: string}>}
 */
async function stopInstance(instanceId) {
	const command = new StopInstancesCommand({
		InstanceIds: [instanceId],
	});
	const response = await ec2Client.send(command);
	const instance = response.StoppingInstances[0];
	return {
		state: instance.CurrentState.Name,
	};
}

/**
 * Reboot EC2 instance
 * @param {string} instanceId
 * @returns {Promise<void>}
 */
async function rebootInstance(instanceId) {
	const command = new RebootInstancesCommand({
		InstanceIds: [instanceId],
	});
	await ec2Client.send(command);
}

/**
 * Execute SSM command on instance
 * @param {string} instanceId
 * @param {string[]} commands
 * @returns {Promise<{commandId: string}>}
 */
async function executeSSMCommand(instanceId, commands) {
	const command = new SendCommandCommand({
		InstanceIds: [instanceId],
		DocumentName: "AWS-RunShellScript",
		Parameters: {
			commands: commands,
		},
	});
	const response = await ssmClient.send(command);
	return {
		commandId: response.Command.CommandId,
	};
}

/**
 * Get secret from Secrets Manager
 * @param {secretName} string
 * @returns {Promise<string>}
 */
async function getSecret(secretName) {
	const command = new GetSecretValueCommand({
		SecretId: secretName,
	});
	const response = await secretsClient.send(command);
	return response.SecretString;
}

/**
 * List objects in S3 bucket with optional prefix
 * @param {string} bucketName
 * @param {string} prefix
 * @returns {Promise<Array<{key: string, size: number, lastModified: Date}>>}
 */
async function listS3Objects(bucketName, prefix = "") {
	const command = new ListObjectsV2Command({
		Bucket: bucketName,
		Prefix: prefix,
	});
	const response = await s3Client.send(command);
	
	if (!response.Contents || response.Contents.length === 0) {
		return [];
	}
	
	return response.Contents.map(obj => ({
		key: obj.Key,
		size: obj.Size,
		lastModified: obj.LastModified,
	}));
}

/**
 * Generate a pre-signed PUT URL for S3 upload
 * @param {string} bucketName
 * @param {string} key - S3 object key/path
 * @param {number} expiresIn - Seconds until URL expires (default: 1 hour)
 * @returns {Promise<string>}
 */
async function getSignedUploadUrl(bucketName, key, expiresIn = 3600) {
	const command = new PutObjectCommand({
		Bucket: bucketName,
		Key: key,
	});
	return getSignedUrl(s3Client, command, {expiresIn});
}

module.exports = {
	ec2Client,
	ssmClient,
	secretsClient,
	s3Client,
	getInstanceStatus,
	getMultipleInstanceStatus,
	startInstance,
	stopInstance,
	rebootInstance,
	executeSSMCommand,
	getSecret,
	listS3Objects,
	getSignedUploadUrl,
};
