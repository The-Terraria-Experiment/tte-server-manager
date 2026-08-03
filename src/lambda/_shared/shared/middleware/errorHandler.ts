import type { APIGatewayProxyResult, Context } from "aws-lambda";
import { ResponseUtil } from "../utils/APIResponse.js";
import { CWLogger } from "../aws/CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";
import { redactCredentials, redactToJson } from "../utils/Redact.js";
import type { LambdaHandler } from "../../../../shared/types/LambdaTypes.js";

/**
 * Both fields are redacted here rather than at each use site: the message is logged *and*
 * returned to the caller verbatim on the mapped 4xx paths below, and a stack's first line
 * is the message again.
 */
function getErrorDetails(error: unknown): { message: string; stack?: string } {
	if (error instanceof Error) {
		if (error.stack !== undefined) {
			return {
				message: redactCredentials(error.message),
				stack: redactCredentials(error.stack),
			};
		}

		return {
			message: redactCredentials(error.message),
		};
	}

	return {
		message: redactCredentials(String(error)),
	};
}

/**
 * General-purpose Lambda error logger
 */
export async function logError(error: unknown, event: unknown = null): Promise<APIGatewayProxyResult> {
	const details = getErrorDetails(error);
	const safeEvent = redactToJson(event);

	// Keep the raw console.error just-in-case; CloudWatch still captures it even though
	// its non-JSON shape isn't picked up by the indexed log queries.
	console.error("Lambda error:", {
		error: details.message,
		stack: details.stack,
		event: safeEvent,
	});

	// Also emit a structured entry to the general error log so it lands in the indexed
	// CloudWatch logs. CWLogger.Error swallows its own failures, so this never masks the
	// original error, but guard anyway so logging can't change the response we return.
	try {
		await CWLogger.Error(CW_LOG_GENERAL, {
			error: details.message,
			...(details.stack !== undefined ? { stack: details.stack } : {}),
			details: { event: safeEvent },
		});
	} catch {
		// Logging is best-effort; fall through to return the mapped response.
	}

	// Map common errors to appropriate status codes
	if (details.message.includes("Permission denied") || details.message.includes("Unauthorized")) {
		return ResponseUtil.PermissionDeniedError(details.message);
	}

	if (details.message.includes("not found")) {
		return ResponseUtil.Error(details.message, 404, "NOT_FOUND");
	}

	if (details.message.includes("Invalid") || details.message.includes("required")) {
		return ResponseUtil.Error(details.message, 400, "VALIDATION_ERROR");
	}

	// Default 500 error
	return ResponseUtil.Error("Internal server error", 500, "INTERNAL_ERROR");
}

/**
 * Wrap handler with error handling
 */
export function errorHandler<TEvent = unknown>(handler: LambdaHandler<TEvent>): LambdaHandler<TEvent> {
	return async (event: TEvent, context: Context): Promise<APIGatewayProxyResult> => {
		try {
			return await handler(event, context);
		} catch (error) {
			return logError(error, event);
		}
	};
}
