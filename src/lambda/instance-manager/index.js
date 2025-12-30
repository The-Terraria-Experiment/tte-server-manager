/**
 * Instance Manager Lambda
 * Handles EC2 instance lifecycle operations (start, stop, restart, status)
 */

const {validatePermission} = require("./shared/utils/permissions");
const {errorHandler} = require("./shared/middleware/errorHandler");
const {notFoundError} = require("./shared/utils/response");
const {PERMISSIONS} = require("./shared/permissionValues");

const endpoints = {
	"GET /instances": {
		action: require("./actions/list"),
		permRequired: PERMISSIONS.instance.list,
	},
	"GET /instance/{id}/status": {
		action: require("./actions/getStatus"),
		permRequired: PERMISSIONS.instance.status.read,
	},
	"POST /instance/{id}/start": {
		action: require("./actions/start"),
		permRequired: PERMISSIONS.instance.status.start,
	},
	"POST /instance/{id}/stop": {
		action: require("./actions/stop"),
		permRequired: PERMISSIONS.instance.status.stop,
	},
	"POST /instance/{id}/restart": {
		action: require("./actions/restart"),
		permRequired: PERMISSIONS.instance.status.restart,
	},
	"GET /instance/{id}/metrics": {
		action: null,
		permRequired: PERMISSIONS.instance.metrics.read,
	},
	"GET /instance/{id}/files": {
		action: null,
		permRequired: PERMISSIONS.instance.files.read,
	},
	"POST /instance/{id}/files": {
		action: null,
		permRequired: PERMISSIONS.instance.files.write,
	},
};

exports.handler = errorHandler(async (event, context) => {
	console.log("Instance Manager:", {httpMethod: event.httpMethod, path: event.path});

	const {httpMethod, resource} = event;
	const routeKey = `${httpMethod} ${resource}`;

	// Find matching action
	const action = endpoints[routeKey];
	if (!action || !action.action) {
		return notFoundError("Route");
	}

	// Do permission check
	await validatePermission(event, action.permRequired);

	// Actual action
	return action.action.handle(event, context);
});
