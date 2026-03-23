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
 * Logs an entry to CloudWatch custom log group by type
 * @param {string} functionName - Lambda function name (e.g., 'instance-manager', 'server-manager')
 * @param {'actions'|'errors'} logType - Log type suffix for the log group path
 * @param {object} logPayload - Structured log payload
 * @param {number} [logPayload.timestamp] - Timestamp (defaults to now)
 * @returns {Promise<void>}
 */
async function logEntry(functionName, logType, logPayload) {
	if (![...Object.values(FUNC_NAMES), CW_LOG_GENERAL].includes(functionName)) {
		throw new Error(`Invalid function name '${functionName}'`);
	}

	if (!['actions', 'errors'].includes(logType)) {
		throw new Error(`Invalid log type '${logType}'`);
	}
	
	const environment = "-" + process.env.ACTIVE_ENV;

	const logGroupName = `/aws/lambda/${functionName}${environment}/${logType}`;
	const logStreamName = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
	const streamKey = `${logGroupName}/${logStreamName}`;
	
	try {
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

		const timestamp = logPayload.timestamp || Date.now();
		const logMessage = {
			timestamp,
			...logPayload,
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
		console.error(`CloudWatch logging to stream [${streamKey}] failed: ${err.message}`);
		console.log('CloudWatch log fallback:', JSON.stringify(logPayload));
	}
}

/**
 * Logs an action to CloudWatch custom action log group
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
	return logEntry(functionName, 'actions', {
		userId: actionLog.userId,
		action: actionLog.action,
		resource: actionLog.resource,
		status: actionLog.status || 'ok',
		details: actionLog.details || {},
		...(actionLog.error && { error: actionLog.error }),
		timestamp: actionLog.timestamp,
	});
}

/**
 * Logs an error to CloudWatch custom error log group
 * @param {string} functionName - Lambda function name (e.g., 'instance-manager', 'server-manager')
 * @param {object} errorLog - Log object with error details
 * @param {string} [errorLog.userId] - User sub/ID associated with the error
 * @param {string} [errorLog.action] - Action that caused the error
 * @param {string} [errorLog.resource] - Resource associated with the error
 * @param {string} errorLog.error - Error message
 * @param {string} [errorLog.stack] - Error stack trace
 * @param {object} [errorLog.details] - Additional error context
 * @param {number} [errorLog.timestamp] - Timestamp (defaults to now)
 * @returns {Promise<void>}
 */
async function logError(functionName, errorLog) {
	return logEntry(functionName, 'errors', {
		userId: errorLog.userId,
		action: errorLog.action,
		resource: errorLog.resource,
		error: errorLog.error,
		stack: errorLog.stack,
		details: errorLog.details || {},
		status: 'ERROR',
		timestamp: errorLog.timestamp,
	});
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
	logEntry,
	logAction,
	logError,
	logActionCond,
};
