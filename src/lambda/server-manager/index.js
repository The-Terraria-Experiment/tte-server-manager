/**
 * Server Manager Lambda
 * Handles TShock game server operations (status, commands, TShock API)
 */

const {validatePermission} = require("../shared/utils/permissions");
const {errorHandler} = require("../shared/middleware/errorHandler");
const {notFoundError} = require("../shared/utils/response");

// Action handlers
const actions = {
	"GET /servers": require("./actions/list"),
	"GET /server/{id}/status": require("./actions/getStatus"),
	"POST /server/{id}/start": null,
	"POST /server/{id}/stop": null,
	"GET /server/{id}/config": null,
	"POST /server/{id}/config": null,
	"POST /server/{id}/tshock": null,
	"GET /server/{id}/world/list": null, 
	"POST /server/{id}/world/create": null, 
	"POST /server/{id}/world/{worldId}/select": null, 
	"DELETE /server/{id}/world/{worldId}/delete": null, 
};

exports.handler = errorHandler(async (event, context) => {
	console.log("Server Manager:", {httpMethod: event.httpMethod, path: event.path});

	const {httpMethod, resource} = event;
	const routeKey = `${httpMethod} ${resource}`;

	// Find matching action
	const action = actions[routeKey];
	if (!action) {
		return notFoundError("Route");
	}

	// Validate permissions
	const actionType = httpMethod === "GET" ? "read" : "execute";
	await validatePermission(event, "server", actionType);

	// Execute action
	return action.handle(event, context);
});
