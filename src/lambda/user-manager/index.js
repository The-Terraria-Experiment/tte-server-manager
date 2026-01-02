/**
 * User Manager Lambda
 * Handles user permissions, roles, and user data operations
 */

const {validatePermission} = require("./shared/utils/permissions");
const {errorHandler} = require("./shared/middleware/errorHandler");
const {notFoundError} = require("./shared/utils/response");
const {PERMISSIONS} = require("./shared/permissionValues");

const endpoints = {
	"GET /users": {
		action: null,
		permRequired: PERMISSIONS.users.list,
	},
	"GET /users/logs": {
		action: null,
		permRequired: PERMISSIONS.users.logs.read,
	},
	"GET /users/permissions": {
		action: require("./actions/readPermissions"),
		permRequired: PERMISSIONS.users.permissions.read,
	},
	"POST /users/permissions": {
		action: require("./actions/writePermissions"),
		permRequired: PERMISSIONS.users.permissions.write,
	},
	"GET /users/permissions/getown": {
		action: require("./actions/readOwnPermissions"),
		permRequired: PERMISSIONS.access
	},
	"POST /users/username": {
		action: require("./actions/setUsername"),
		permRequired: PERMISSIONS.access
	}
};

exports.handler = errorHandler(async (event, context) => {
	console.log("User Manager:", {httpMethod: event.httpMethod, path: event.path});

	const {httpMethod, resource} = event;
	const routeKey = `${httpMethod} ${resource}`;

	// Find matching action
	const action = endpoints[routeKey];
	if (!action || !action.action) {
		return notFoundError("Route");
	}

	// Do permission check
	await validatePermission(event, action.permRequired);

	if (event.body && typeof event.body === 'string' || event.body instanceof String) {
		try {
			event.parsedBody = JSON.parse(event.body);
		} catch (e) {
			console.warn("Failed to parse event body. Event body: ", event.body);
			event.parsedBody = event.body;
		}
	}

	// Execute action
	return action.action.handle(event, context);
});
