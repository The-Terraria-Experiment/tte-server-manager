/**
 * Instance Manager Lambda
 * Handles EC2 instance lifecycle operations (start, stop, restart, status)
 */

const {validatePermission} = require("../shared/utils/permissions");
const {errorHandler} = require("../shared/middleware/errorHandler");
const {notFoundError} = require("../shared/utils/response");

// Action handlers
const actions = {
	"GET /instances": require("./actions/list"),
	"GET /instance/{id}/status": require("./actions/getStatus"),
	"POST /instance/{id}/start": require("./actions/start"),
	"POST /instance/{id}/stop": require("./actions/stop"),
	"POST /instance/{id}/restart": require("./actions/restart"),
	"GET /instance/{id}/metrics": null, //todo
	"GET /instance/{id}/files": null,
	"POST /instance/{id}/files": null
};

exports.handler = errorHandler(async (event, context) => {
	console.log("Instance Manager:", {httpMethod: event.httpMethod, path: event.path});

	const {httpMethod, resource} = event;
	const routeKey = `${httpMethod} ${resource}`;

	// Find matching action
	const action = actions[routeKey];
	if (!action) {
		return notFoundError("Route");
	}

	// Validate permissions (read for GET, write for POST/PUT/DELETE)
	const actionType = httpMethod === "GET" ? "read" : "write";
	await validatePermission(event, "instance", actionType);

	// Execute action
	return action.handle(event, context);
});
