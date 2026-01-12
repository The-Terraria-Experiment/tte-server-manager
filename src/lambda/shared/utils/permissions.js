/**
 * Permission validation utilities
 * Checks user permissions against DynamoDB permission entries
 */

const { logAction } = require("./cloudwatchLogger");
const { PERM_TABLE, CW_LOG_GENERAL } = require("../constants");
const { assertIsTruthyString, assertIsTruthy } = require("../middleware/assert");
const {getDynamoItem} = require("./dynamo");

/**
 * Validate user has permission for resource/action
 * @param {object} event - API Gateway event (contains requestContext.authorizer.claims)
 * @param {string} permission - Permission to validate
 * @throws {Error} if permission denied
 */
async function validatePermission(event, permission) {
	assertIsTruthyString(permission, "validatePermission requires permission value");
	assertIsTruthy(event, "validatePermission requires a Gateway event");

	const userSub = event.requestContext?.authorizer?.claims?.sub;
	if (!userSub) {
		logAction(CW_LOG_GENERAL, {
			userId: userSub ?? 'unknown',
			action: "attempt-perm-check",
			status: '401',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { permRequired: permission }
		});

		throw new Error("Unauthorized: No user context");
	}

	const permitted = await checkPermission(userSub, permission);
	if (!permitted) {
		logAction(CW_LOG_GENERAL, {
			userId: userSub ?? 'unknown',
			action: "attempt-perm-check",
			status: '403',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { permRequired: permission }
		});

		throw new Error(`Permission denied to <${userSub}> for resource <${event.httpMethod} ${event.resource}>`);
	}
}

/**
 * Check if user has specific permission
 */
async function checkPermission(userSub, permission) {
	const item = await getDynamoItem(PERM_TABLE, `user#${userSub}`);

	if (!item || !item.permissions) return false;

	const existingPerms = new Set(item.permissions || []);
	if (existingPerms.has(permission)) {
		return true;
	}

	return false;
}

module.exports = {
	validatePermission,
	checkPermission,
};
