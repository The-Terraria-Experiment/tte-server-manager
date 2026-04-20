import type { APIGatewayProxyResult } from "aws-lambda";

export const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
	"Access-Control-Allow-Headers": "Content-Type,Authorization",
	"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};

export class ResponseUtil {
	/**
	 * Success response
	 */
	public static Success<T>(data: T, statusCode = 200): APIGatewayProxyResult {
		return {
			statusCode,
			headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
			body: JSON.stringify(data),
		};
	}

	/**
	 * Error response
	 */
	public static Error(
		message: string,
		statusCode = 500,
		code = "INTERNAL_ERROR",
		details: unknown = null,
	): APIGatewayProxyResult {
		return {
			statusCode,
			headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
			body: JSON.stringify({
				code,
				message,
				...(details !== null && details !== undefined ? { details } : {}),
			}),
		};
	}

	/**
	 * Validation error (400)
	 */
	public static ValidationError(message: string, details: unknown = null): APIGatewayProxyResult {
		return ResponseUtil.Error(message, 400, "VALIDATION_ERROR", details);
	}

	/**
	 * Permission denied error (403)
	 */
	public static PermissionDeniedError(message = "Permission denied"): APIGatewayProxyResult {
		return ResponseUtil.Error(message, 403, "PERMISSION_DENIED");
	}

	/**
	 * Not found error (404)
	 */
	public static NotFoundError(resource = "Resource"): APIGatewayProxyResult {
		return ResponseUtil.Error(`${resource} not found`, 404, "NOT_FOUND");
	}
}
