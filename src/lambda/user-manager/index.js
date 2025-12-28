/**
 * User Manager Lambda
 * Handles user permissions, roles, and user data operations
 */

const {validatePermission} = require("./shared/utils/permissions");
const {errorHandler} = require("./shared/middleware/errorHandler");
const {notFoundError} = require("./shared/utils/response");

// Action handlers
const actions = {
	"GET /users/permissions": require("./actions/getPermissions"),
	"POST /users/permissions": require("./actions/grantPermission"), // todo: grant and revoke are different actions, we'll just send a full list
	"GET /users": require("./actions/listUsers"),
	//   'GET /users/{id}': require('./actions/getUser'), //? probably don't need
	"GET /users/logs": null,
};

exports.handler = errorHandler(async (event, context) => {
	console.log("User Manager:", {httpMethod: event.httpMethod, path: event.path});

	const {httpMethod, resource} = event;
	const routeKey = `${httpMethod} ${resource}`;

	// Find matching action
	const action = actions[routeKey];
	if (!action) {
		return notFoundError("Route");
	}

	// Validate permissions (admin for grants/revokes, read for queries)
	const requiresAdmin = httpMethod === "POST" && resource.includes("/permissions/");
	const actionType = requiresAdmin ? "admin" : "read";
	await validatePermission(event, "user", actionType);

	// Execute action
	return action.handle(event, context);
});
