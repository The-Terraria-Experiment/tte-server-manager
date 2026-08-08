import type { APIGatewayProxyResult } from "aws-lambda";
import { CWLogger } from "../../aws/CloudWatch.js";
import { CW_LOG_GENERAL } from "../../constants.js";
import { redact, redactCredentials } from "./Redact.js";

const ALLOWED_ORIGINS: Set<string> = new Set(
	(process.env.ALLOWED_ORIGIN || "")
		.split(",")
		.map(o => o.trim())
		.filter(Boolean)
);

export function resolveCorsOrigin(requestOrigin?: string): string {
	if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
		return requestOrigin;
	}
	return ALLOWED_ORIGINS.size > 0 ? [...ALLOWED_ORIGINS][0]! : "*";
}

export const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": resolveCorsOrigin(),
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
		// Most callers pass a caught `e.message` straight through, so this is the last point
		// at which an internal string can be stopped from reaching both CloudWatch and the
		// browser. Redact here rather than trusting every call site to have done it.
		const safeMessage = redactCredentials(message);
		const safeDetails = details === null || details === undefined ? details : redact(details);

		CWLogger.Error(CW_LOG_GENERAL, {
			error: safeMessage,
			stack: new Error().stack,
			details: {
				statusCode,
				code,
				givenDetails: safeDetails
			}
		});

		return {
			statusCode,
			headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
			body: JSON.stringify({
				code,
				message: safeMessage,
				...(safeDetails !== null && safeDetails !== undefined ? { details: safeDetails } : {}),
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
