/**
 * Permission validation utilities
 * Checks user permissions against DynamoDB permission entries
 */

const {getDynamoItem} = require("./dynamo");

/**
 * Validate user has permission for resource/action
 * @param {object} event - API Gateway event (contains requestContext.authorizer.claims)
 * @param {string} resource - Resource type (instance, server, user, file)
 * @param {string} action - Action (read, write, execute, admin)
 * @throws {Error} if permission denied
 */
async function validatePermission(event, resource, action) {
	// TODO: Extract user sub from event.requestContext.authorizer.claims.sub
	// TODO: Query DynamoDB PermissionEntries table
	// TODO: Check if user has role/permission for this resource/action
	// TODO: Throw error if denied

	const userSub = event.requestContext?.authorizer?.claims?.sub;
	if (!userSub) {
		throw new Error("Unauthorized: No user context");
	}

	// Example check logic:
	// const permitted = await checkPermission(userSub, resource, action);
	// if (!permitted) throw new Error(`Permission denied: ${action} on ${resource}`);
}

/**
 * Check if user has specific permission
 */
async function checkPermission(userSub, resource, action) {
	// TODO: Implement permission lookup in DynamoDB
	// Return true/false
	return true; // Placeholder
}

module.exports = {
	validatePermission,
	checkPermission,
};
