/**
 * Error handling middleware wrapper
 * Catches errors and returns standardized error responses
 */

const { errorResponse, permissionDeniedError } = require("../utils/response");

/**
 * General-purpose Lambda error logger
 * @param {Error} error 
 * @returns 
 */
function logError(error, event = null) {
	console.error("Lambda error:", {
		error: error.message,
		stack: error.stack,
		event: event ? JSON.stringify(event) : null,
	});

	// Map common errors to appropriate status codes
	if (error.message.includes("Permission denied") || error.message.includes("Unauthorized")) {
		return permissionDeniedError(error.message);
	}

	if (error.message.includes("not found")) {
		return errorResponse(error.message, 404, "NOT_FOUND");
	}

	if (error.message.includes("Invalid") || error.message.includes("required")) {
		return errorResponse(error.message, 400, "VALIDATION_ERROR");
	}

	// Default 500 error
	return errorResponse("Internal server error", 500, "INTERNAL_ERROR");
}

/**
 * Wrap handler with error handling
 */
function errorHandler(handler) {
	return async (event, context) => {
		try {
			return await handler(event, context);
		} catch (error) {
			return logError(error, event);
		}
	};
}

module.exports = {errorHandler, logError};
