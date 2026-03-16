/**
 * Server Manager Lambda
 * Handles TShock game server operations (status, commands, TShock API)
 */

const {validatePermission, getUserSub} = require("./shared/utils/permissions");
const {errorHandler} = require("./shared/middleware/errorHandler");
const {notFoundError} = require("./shared/utils/response");
const {PERMISSIONS} = require("./shared/permissionValues");
const { logAction } = require("./shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("./shared/constants");

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
		action: require("./actions/readConfig"),
		permRequired: PERMISSIONS.server.config.read,
	},
	"POST /server/{id}/config": {
		action: require("./actions/writeConfig"),
		permRequired: PERMISSIONS.server.config.write,
	},
	"POST /server/{id}/config/reload": {
		action: require("./actions/reloadConfig"),
		permRequired: PERMISSIONS.server.config.write,
	},
	// "PUT /server/{id}/config": {
	// 	action: require("./actions/writeConfig"),
	// 	permRequired: PERMISSIONS.server.config.write,
	// },
	"POST /server/{id}/tshock": {
		action: null,
		permRequired: PERMISSIONS.server.tshock.execute,
	},
	"GET /server/{id}/world/list": {
		action: null,
		permRequired: PERMISSIONS.server.world.list,
	},
	"POST /server/{id}/world/create": {
		action: require("./actions/createWorld"),
		permRequired: PERMISSIONS.server.world.create,
	},
	"GET /server/{id}/world/create/{jobId}/status": {
		action: require("./actions/createWorldStatus"),
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
	"POST /server/dropcache": {
		action: require("./actions/dropTokenCache"),
		permRequired: PERMISSIONS.system.dropcache
	},
	"POST /server/{id}/players/ban": {
		action: require("./actions/managePlayer"),
		permRequired: PERMISSIONS.server.player.ban
	},
	"POST /server/{id}/players/kick": {
		action: require("./actions/managePlayer"),
		permRequired: PERMISSIONS.server.player.kick
	},
	"POST /server/{id}/players/kill": {
		action: require("./actions/managePlayer"),
		permRequired: PERMISSIONS.server.player.kill
	},
	"POST /server/{id}/players/mute": {
		action: require("./actions/managePlayer"),
		permRequired: PERMISSIONS.server.player.mute
	},
	"GET /server/{id}/players/{player}": {
		action: require("./actions/readPlayer"),
		permRequired: PERMISSIONS.server.player.read
	},
	"GET /server/{id}/bans": {
		action: require("./actions/getBans"),
		permRequired: PERMISSIONS.server.player.ban
	},
	"POST /server/{id}/bans/delete": {
		action: require("./actions/deleteBan"),
		permRequired: PERMISSIONS.server.player.ban
	}
};

exports.handler = errorHandler(async (event, context) => {
	if (event?.internalAction === "create-world-worker") {
		return require("./actions/createWorld").handle(event, context);
	}

	if (event.body && typeof event.body === 'string' || event.body instanceof String) {
		try {
			event.parsedBody = JSON.parse(event.body);
		} catch (e) {
			console.warn("Failed to parse event body. Event body: ", event.body);
			event.parsedBody = event.body;
		}
	}

	console.log("Server Manager:", { httpMethod: event.httpMethod, path: event.path });
	logAction(FUNC_NAMES.SERV_MGR, {
		userId: getUserSub(event) ?? "unknown",
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
		userId: getUserSub(event) ?? "unknown",
		action: "invoke-action",
		status: 'permission-validated',
		resource: routeKey,
		details: { context, event }
	});

	// Actual action
	return action.action.handle(event, context);
});
