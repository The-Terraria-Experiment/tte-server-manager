/**
 * AWS SDK helper utilities
 * Centralized AWS service interactions (EC2, S3, SSM, Secrets Manager, etc.)
 */

const {EC2Client, StartInstancesCommand, StopInstancesCommand, DescribeInstancesCommand} = require("@aws-sdk/client-ec2");
const {SSMClient, SendCommandCommand} = require("@aws-sdk/client-ssm");
const {SecretsManagerClient, GetSecretValueCommand} = require("@aws-sdk/client-secrets-manager");
const {S3Client} = require("@aws-sdk/client-s3");

const ec2Client = new EC2Client({region: process.env.AWS_REGION});
const ssmClient = new SSMClient({region: process.env.AWS_REGION});
const secretsClient = new SecretsManagerClient({region: process.env.AWS_REGION});
const s3Client = new S3Client({region: process.env.AWS_REGION});

/**
 * Get EC2 instance status
 * @param {string} instanceId
 * @returns {Promise<{state: string, publicIp: string, launchTime: string, instanceType: string}>}
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
	return {
		state: instance.State.Name, // pending | running | shutting-down | terminated | stopping | stopped
		publicIp: instance.PublicIpAddress || "pending",
		launchTime: instance.LaunchTime,
		instanceType: instance.InstanceType,
		// availabilityZone: instance.Placement.AvailabilityZone,
	};
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
			command: commands,
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

module.exports = {
	ec2Client,
	ssmClient,
	secretsClient,
	s3Client,
	getInstanceStatus,
	startInstance,
	stopInstance,
	executeSSMCommand,
	getSecret,
};
