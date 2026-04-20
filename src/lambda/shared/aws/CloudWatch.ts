import {
	CloudWatchLogsClient,
	CreateLogStreamCommand,
	PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { CW_LOG_GENERAL, FUNC_NAMES } from "../constants";

export interface LoggerActionPayload {
	userId?: string | null | undefined;
	action?: string | undefined;
	resource?: string | null | undefined;
	status?: string | undefined;
	details?: Record<string, unknown> | undefined;
	error?: string | undefined;
	timestamp?: number | undefined;
}

export interface LoggerErrorPayload {
	userId?: string | null | undefined;
	action?: string | undefined;
	resource?: string | null | undefined;
	error: string;
	stack?: string | undefined;
	details?: Record<string, unknown> | undefined;
	timestamp?: number | undefined;
}

export class CWLogger {
	private static readonly cloudwatchClient = new CloudWatchLogsClient({
		region: process.env.AWS_REGION || "us-east-2",
	});

	private static readonly existingStreams = new Set<string>();

	public static async logEntry(
		functionName: string,
		logType: "actions" | "errors",
		logPayload: LoggerActionPayload | LoggerErrorPayload,
	): Promise<void> {
		if (![...Object.values(FUNC_NAMES), CW_LOG_GENERAL].includes(functionName)) {
			throw new Error(`Invalid function name '${functionName}'`);
		}

		if (!["actions", "errors"].includes(logType)) {
			throw new Error(`Invalid log type '${logType}'`);
		}

		const environment = `-${process.env.ACTIVE_ENV}`;
		const logGroupName = `/aws/lambda/${functionName}${environment}/${logType}`;
		const logStreamName = new Date().toISOString().split("T")[0];
		const streamKey = `${logGroupName}/${logStreamName}`;

		try {
			if (!CWLogger.existingStreams.has(streamKey)) {
				try {
					await CWLogger.cloudwatchClient.send(
						new CreateLogStreamCommand({
							logGroupName,
							logStreamName,
						}),
					);
					CWLogger.existingStreams.add(streamKey);
				} catch (error) {
					const err = error as Error;
					if (!err.message.includes("ResourceAlreadyExistsException")) {
						console.error(`Failed to create log stream: ${err.message}`);
					}
					CWLogger.existingStreams.add(streamKey);
				}
			}

			const timestamp = logPayload.timestamp || Date.now();
			const logMessage = {
				timestamp,
				...logPayload,
			};

			await CWLogger.cloudwatchClient.send(
				new PutLogEventsCommand({
					logGroupName,
					logStreamName,
					logEvents: [
						{
							timestamp,
							message: JSON.stringify(logMessage),
						},
					],
				}),
			);
		} catch (error) {
			const err = error as Error;
			console.error(`CloudWatch logging to stream [${streamKey}] failed: ${err.message}`);
			console.log("CloudWatch log fallback:", JSON.stringify(logPayload));
		}
	}

	public static async Action(functionName: string, actionLog: LoggerActionPayload): Promise<void> {
		const payload: LoggerActionPayload = {
			status: actionLog.status || "ok",
			details: actionLog.details || {},
		};

		if (actionLog.userId !== undefined) payload.userId = actionLog.userId;
		if (actionLog.action !== undefined) payload.action = actionLog.action;
		if (actionLog.resource !== undefined) payload.resource = actionLog.resource;
		if (actionLog.error !== undefined) payload.error = actionLog.error;
		if (actionLog.timestamp !== undefined) payload.timestamp = actionLog.timestamp;

		await CWLogger.logEntry(functionName, "actions", payload);
	}

	public static async Error(functionName: string, errorLog: LoggerErrorPayload): Promise<void> {
		const payload: LoggerErrorPayload & { status: string } = {
			error: errorLog.error,
			details: errorLog.details || {},
			status: "ERROR",
		};

		if (errorLog.userId !== undefined) payload.userId = errorLog.userId;
		if (errorLog.action !== undefined) payload.action = errorLog.action;
		if (errorLog.resource !== undefined) payload.resource = errorLog.resource;
		if (errorLog.stack !== undefined) payload.stack = errorLog.stack;
		if (errorLog.timestamp !== undefined) payload.timestamp = errorLog.timestamp;

		await CWLogger.logEntry(functionName, "errors", payload);
	}

	public static async CAction(
		levelRequired: number,
		functionName: string,
		actionLog: LoggerActionPayload,
	): Promise<void> {
		if (process.env?.LOG_LEVEL && Number(process.env.LOG_LEVEL) >= levelRequired) {
			await CWLogger.Action(functionName, actionLog);
		}
	}
}
