import type { APIGatewayProxyResult, Context } from "aws-lambda";
import { ResponseUtil } from "../utils/APIResponse.js";

function getErrorDetails(error: unknown): { message: string; stack?: string } {
	if (error instanceof Error) {
		if (error.stack !== undefined) {
			return {
				message: error.message,
				stack: error.stack,
			};
		}

		return {
			message: error.message,
		};
	}

	return {
		message: String(error),
	};
}

/**
 * General-purpose Lambda error logger
 */
function logError(error: unknown, event: unknown = null): APIGatewayProxyResult {
	const details = getErrorDetails(error);

	console.error("Lambda error:", {
		error: details.message,
		stack: details.stack,
		event: event ? JSON.stringify(event) : null,
	});

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

export type LambdaHandler<TEvent = unknown> = (
	event: TEvent,
	context: Context,
) => Promise<APIGatewayProxyResult>;

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
