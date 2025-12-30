/**
 * Permission validation utilities
 * Checks user permissions against DynamoDB permission entries
 */

const { PERM_TABLE } = require("../constants");
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
		throw new Error("Unauthorized: No user context");
	}

	const permitted = await checkPermission(userSub, permission);
	if (!permitted) {
		throw new Error(`Permission denied to <${userSub}> for resource <${event.httpMethod} ${event.resource}>`);
	}
}

/**
 * Check if user has specific permission
 */
async function checkPermission(userSub, permission) {
	const item = await getDynamoItem(PERM_TABLE, `user#${userSub}`);

	if (!item || !item.permissions) return false;

	if (item.permissions.has(permission)) {
		return true;
	}

	return false;
}

module.exports = {
	validatePermission,
	checkPermission,
};
