/**
 * Server Manager Lambda
 * Handles TShock game server operations (status, commands, TShock API)
 */

const {validatePermission} = require("./shared/utils/permissions");
const {errorHandler} = require("./shared/middleware/errorHandler");
const {notFoundError} = require("./shared/utils/response");
const {PERMISSIONS} = require("./shared/permissionValues");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("../shared/constants");

const endpoints = {
	"GET /servers": {
		action: require("./actions/list"),
		permRequired: PERMISSIONS.server.list,
	},
	"GET /server/{id}/status": {
		action: require("./actions/getStatus"),
		permRequired: PERMISSIONS.server.status.read,
	},
	"POST /server/{id}/start": {
		action: require("./actions/selectWorld"),
		permRequired: PERMISSIONS.server.status.start,
	},
	"POST /server/{id}/stop": {
		action: require("./actions/stop"),
		permRequired: PERMISSIONS.server.status.stop,
	},
	"GET /server/{id}/config": {
		action: null,
		permRequired: PERMISSIONS.server.config.read,
	},
	"POST /server/{id}/config": {
		action: null,
		permRequired: PERMISSIONS.server.config.write,
	},
	"POST /server/{id}/tshock": {
		action: null,
		permRequired: PERMISSIONS.server.tshock.execute,
	},
	"GET /server/{id}/world/list": {
		action: null,
		permRequired: PERMISSIONS.server.world.list,
	},
	"POST /server/{id}/world/create": {
		action: null,
		permRequired: PERMISSIONS.server.world.create,
	},
	"POST /server/{id}/world/{worldId}/select": {
		action: require("./actions/selectWorld"),
		permRequired: PERMISSIONS.server.world.select,
	},
	"DELETE /server/{id}/world/{worldId}/delete": {
		action: null,
		permRequired: PERMISSIONS.server.world.delete,
	},
};

exports.handler = errorHandler(async (event, context) => {
	console.log("Server Manager:", { httpMethod: event.httpMethod, path: event.path });
	logAction(FUNC_NAMES.SERV_MGR, {
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

	logAction(FUNC_NAMES.SERV_MGR, {
		userId: event.request.userAttributes.sub,
		action: "invoke-action",
		status: 'permission-validated',
		resource: routeKey,
		details: { context, event }
	});

	// Actual action
	return action.action.handle(event, context);
});
