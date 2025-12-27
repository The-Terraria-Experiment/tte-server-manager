/**
 * AWS SDK helper utilities
 * Centralized AWS service interactions (EC2, S3, SSM, Secrets Manager, etc.)
 */

const { EC2Client, StartInstancesCommand, StopInstancesCommand, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
const { SSMClient, SendCommandCommand } = require('@aws-sdk/client-ssm');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { S3Client } = require('@aws-sdk/client-s3');

const ec2Client = new EC2Client({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.AWS_REGION });

/**
 * Get EC2 instance status
 */
async function getInstanceStatus(instanceId) {
  // TODO: Implement DescribeInstances call
  // Return: { state, publicIp, launchTime, etc. }
}

/**
 * Start EC2 instance
 */
async function startInstance(instanceId) {
  // TODO: Implement StartInstances call
}

/**
 * Stop EC2 instance
 */
async function stopInstance(instanceId) {
  // TODO: Implement StopInstances call
}

/**
 * Execute SSM command on instance
 */
async function executeSSMCommand(instanceId, commands) {
  // TODO: Implement SendCommand
  // Return commandId for tracking
}

/**
 * Get secret from Secrets Manager
 */
async function getSecret(secretName) {
  // TODO: Implement GetSecretValue
  // Cache in Lambda execution context if needed
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
