/**
 * Standardized API response helpers
 * Consistent response format for API Gateway
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

/**
 * Success response
 */
function successResponse(data, statusCode = 200) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

/**
 * Error response
 */
function errorResponse(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      message,
      ...(details && { details }),
    }),
  };
}

/**
 * Validation error (400)
 */
function validationError(message, details = null) {
  return errorResponse(message, 400, 'VALIDATION_ERROR', details);
}

/**
 * Permission denied error (403)
 */
function permissionDeniedError(message = 'Permission denied') {
  return errorResponse(message, 403, 'PERMISSION_DENIED');
}

/**
 * Not found error (404)
 */
function notFoundError(resource = 'Resource') {
  return errorResponse(`${resource} not found`, 404, 'NOT_FOUND');
}

module.exports = {
  successResponse,
  errorResponse,
  validationError,
  permissionDeniedError,
  notFoundError,
  CORS_HEADERS,
};
