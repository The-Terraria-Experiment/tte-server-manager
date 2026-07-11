import {
	CloudWatchLogsClient,
	CreateLogGroupCommand,
	CreateLogStreamCommand,
	PutLogEventsCommand,
	type PutLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";
import { CW_LOG_GENERAL, FUNC_NAMES } from "../constants.js";

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

	private static readonly existingGroups = new Set<string>();

	private static readonly existingStreams = new Set<string>();

	private static readonly outgoing = new Map<string, Promise<PutLogEventsCommandOutput>>();

	// Dedupes concurrent "ensure group+stream exists" work so a burst of first-time log
	// writes issues a single create pass instead of a thundering herd of CreateLog* calls.
	private static readonly ensuring = new Map<string, Promise<void>>();

	private static isTransientAwsError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false;
		}

		const message = error.message || "";
		return [
			"Signature expired",
			"RequestExpired",
			"InvalidSignatureException",
			"RequestTimeout",
			"RequestTimeoutException",
			"Throttling",
			"TooManyRequestsException",
			"RequestThrottled",
		].some((phrase) => message.includes(phrase));
	}

	private static isAlreadyExists(error: unknown): boolean {
		// The SDK reports this on err.name; err.message is a human phrase like
		// "The specified log group already exists", so match either to be safe.
		return (
			error instanceof Error &&
			(error.name === "ResourceAlreadyExistsException" || error.message.includes("already exists"))
		);
	}

	private static sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private static async sendWithRetry(command: any, maxAttempts = 2): Promise<any> {
		let attempt = 0;
		while (true) {
			try {
				return await CWLogger.cloudwatchClient.send(command);
			} catch (error) {
				if (attempt < maxAttempts && CWLogger.isTransientAwsError(error)) {
					attempt += 1;
					await CWLogger.sleep(100 * attempt);
					continue;
				}

				throw error;
			}
		}
	}

	/**
	 * Lazily creates the log group (a permanent resource) and the day's log stream,
	 * tolerating the "already exists" race. Concurrent callers for the same stream share
	 * a single create pass rather than each firing their own CreateLog* commands.
	 */
	private static async ensureStream(logGroupName: string, logStreamName: string, streamKey: string): Promise<void> {
		if (CWLogger.existingStreams.has(streamKey)) {
			return;
		}

		let pending = CWLogger.ensuring.get(streamKey);
		if (!pending) {
			pending = (async () => {
				if (!CWLogger.existingGroups.has(logGroupName)) {
					try {
						await CWLogger.sendWithRetry(new CreateLogGroupCommand({ logGroupName }));
					} catch (error) {
						if (!CWLogger.isAlreadyExists(error)) {
							throw error;
						}
					}
					CWLogger.existingGroups.add(logGroupName);
				}

				try {
					await CWLogger.sendWithRetry(new CreateLogStreamCommand({ logGroupName, logStreamName }));
				} catch (error) {
					if (!CWLogger.isAlreadyExists(error)) {
						throw error;
					}
				}
				CWLogger.existingStreams.add(streamKey);
			})();
			CWLogger.ensuring.set(streamKey, pending);
		}

		try {
			await pending;
		} finally {
			CWLogger.ensuring.delete(streamKey);
		}
	}

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
		const logStreamName = new Date().toISOString().split("T")[0] as string;
		const streamKey = `${logGroupName}/${logStreamName}`;

		try {
			const timestamp = logPayload.timestamp || Date.now();
			const logMessage = {
				timestamp,
				...logPayload,
			};

			const logID = `${logGroupName}-${logStreamName}-${`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;

			// Write straight to the stream. The log group is permanent and the day's stream is
			// created on the first write of the day, so the common path is a single round-trip.
			// We only pay to create the group/stream when PutLogEvents reports they're missing,
			// avoiding two extra CreateLog* calls (and a thundering herd of them under
			// concurrency) on every cold start.
			const putEvents = (): Promise<PutLogEventsCommandOutput> =>
				CWLogger.sendWithRetry(
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

			const logPromise = (async (): Promise<PutLogEventsCommandOutput> => {
				try {
					return await putEvents();
				} catch (error) {
					if (error instanceof Error && error.name === "ResourceNotFoundException") {
						await CWLogger.ensureStream(logGroupName, logStreamName, streamKey);
						return putEvents();
					}
					throw error;
				}
			})();

			CWLogger.outgoing.set(logID, logPromise);
			try {
				await logPromise;
			} finally {
				CWLogger.outgoing.delete(logID);
			}
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

	public static async FlushAll(): Promise<void>
	{
		const allRemaining = Array.from(CWLogger.outgoing.values());
		await Promise.all(allRemaining);
	}
}
