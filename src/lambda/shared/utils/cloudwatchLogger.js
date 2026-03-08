/**
 * CloudWatch custom logger for user action logs
 * Logs to dedicated action log groups separate from Lambda default logs
 * Each Lambda has its own action log group: /aws/lambda/{functionName}/actions
 */

/**
 * Conditional logging levels: (each level includes all previous levels)
 * - Base / 1 (No specific level): All function invocations, all function success returns
 * - 2: Increased action logging (critical shared utilities are also logged)
 * - 3: Increased action logging (all shared utilities are also logged)
 */

const { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand } = require("@aws-sdk/client-cloudwatch-logs");
const { FUNC_NAMES, CW_LOG_GENERAL } = require("../constants");

const cloudwatchClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });

// Cache for log streams we've already created
const existingStreams = new Set();

/**
 * Logs an action to CloudWatch custom log group
 * @param {string} functionName - Lambda function name (e.g., 'instance-manager', 'server-manager')
 * @param {object} actionLog - Log object with action details
 * @param {string} actionLog.userId - User sub/ID performing the action
 * @param {string} actionLog.action - Action name (e.g., 'START_INSTANCE', 'EXECUTE_COMMAND')
 * @param {string} actionLog.resource - Resource being acted upon (e.g., instance ID, server ID)
 * @param {object} actionLog.details - Additional details about the action
 * @param {number} actionLog.timestamp - Timestamp (defaults to now)
 * @param {string} actionLog.status - 'SUCCESS' | 'FAILED' | 'DENIED'
 * @param {string} [actionLog.error] - Error message if status is FAILED
 * @returns {Promise<void>}
 */
async function logAction(functionName, actionLog) {
	if (![...Object.values(FUNC_NAMES), CW_LOG_GENERAL].includes(functionName)) {
		throw new Error(`Invalid function name '${functionName}'`);
	}
	
	const environment = "-" + process.env.ACTIVE_ENV;

	try {
		const logGroupName = `/aws/lambda/${functionName}${environment}/actions`;
		const logStreamName = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
		const streamKey = `${logGroupName}/${logStreamName}`;

		// Create log stream if it doesn't exist
		if (!existingStreams.has(streamKey)) {
			try {
				await cloudwatchClient.send(
					new CreateLogStreamCommand({
						logGroupName,
						logStreamName,
					})
				);
				existingStreams.add(streamKey);
			} catch (err) {
				// Log stream might already exist, which is fine
				if (!err.message.includes('ResourceAlreadyExistsException')) {
					console.error(`Failed to create log stream: ${err.message}`);
				}
				existingStreams.add(streamKey);
			}
		}

		// Prepare log message with structured format
		const timestamp = actionLog.timestamp || Date.now();
		const logMessage = {
			timestamp,
			userId: actionLog.userId,
			action: actionLog.action,
			resource: actionLog.resource,
			status: actionLog.status || 'ok',
			details: actionLog.details || {},
			...(actionLog.error && { error: actionLog.error }),
		};

		await cloudwatchClient.send(
			new PutLogEventsCommand({
				logGroupName,
				logStreamName,
				logEvents: [
					{
						timestamp,
						message: JSON.stringify(logMessage),
					},
				],
			})
		);
	} catch (err) {
		// Log to console as fallback if CloudWatch fails
		console.error(`CloudWatch logging failed: ${err.message}`);
		console.log('Action log fallback:', JSON.stringify(actionLog));
	}
}

/**
 * Conditionally logs an action based on the function's active logging level
 * @param {string} functionName - Lambda function name (e.g., 'instance-manager', 'server-manager')
 * @param {object} actionLog - Log object with action details
 * @param {string} actionLog.userId - User sub/ID performing the action
 * @param {string} actionLog.action - Action name (e.g., 'START_INSTANCE', 'EXECUTE_COMMAND')
 * @param {string} actionLog.resource - Resource being acted upon (e.g., instance ID, server ID)
 * @param {object} actionLog.details - Additional details about the action
 * @param {number} actionLog.timestamp - Timestamp (defaults to now)
 * @param {string} actionLog.status - 'SUCCESS' | 'FAILED' | 'DENIED'
 * @param {string} [actionLog.error] - Error message if status is FAILED
 * @returns {Promise<void>}
 */
async function logActionCond(levelRequired, functionName, actionLog) {
	if (process.env?.LOG_LEVEL && (Number(process.env?.LOG_LEVEL) >= levelRequired)) {
		return logAction(functionName, actionLog);
	}
}

module.exports = {
	logAction,
	logActionCond,
};
