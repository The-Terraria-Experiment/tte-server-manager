/**
 * Instance Manager Lambda
 * Handles EC2 instance lifecycle operations (start, stop, restart, status)
 */

const {validatePermission} = require("./shared/utils/permissions");
const {errorHandler} = require("./shared/middleware/errorHandler");
const {notFoundError} = require("./shared/utils/response");
const {PERMISSIONS} = require("./shared/permissionValues");
const { FUNC_NAMES } = require("./shared/constants");
const { logAction } = require("./shared/utils/cloudwatchLogger");

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
		action: require("./actions/readFiles"),
		permRequired: PERMISSIONS.instance.files.read,
	},
	"POST /instance/{id}/files": {
		action: require("./actions/uploadFiles"),
		permRequired: PERMISSIONS.instance.files.write,
	},
	"PUT /instance/{id}/files": {
		action: require("./actions/fileSync"),
		permRequired: PERMISSIONS.instance.files.write,
	},
	"POST /instance/{id}/paths": {
		action: require("./actions/editPaths"),
		permRequired: PERMISSIONS.instance.files.paths.write,
	}
};

exports.handler = errorHandler(async (event, context) => {
	console.log("Instance Manager:", { httpMethod: event.httpMethod, path: event.path });
	logAction(FUNC_NAMES.INST_MGR, {
		userId: event.request.userAttributes.sub,
		action: "invoke",
		resource: null,
	});

	const {httpMethod, resource} = event;
	const routeKey = `${httpMethod} ${resource}`;

	// Find matching action
	const action = endpoints[routeKey];
	if (!action || !action.action) {
		return notFoundError("Route");
	}

	// Do permission check
	await validatePermission(event, action.permRequired);

	logAction(FUNC_NAMES.INST_MGR, {
		userId: event.request.userAttributes.sub,
		action: "invoke-action",
		status: 'permission-validated',
		resource: routeKey,
		details: { context, event }
	});

	// Actual action
	return action.action.handle(event, context);
});
