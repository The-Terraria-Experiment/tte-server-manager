/**
 * User Manager Lambda
 * Handles user permissions, roles, and user data operations
 */

const {validatePermission} = require("./shared/utils/permissions");
const {errorHandler} = require("./shared/middleware/errorHandler");
const {notFoundError} = require("./shared/utils/response");
const {PERMISSIONS} = require("./shared/permissionValues");
const { logAction } = require("./shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("./shared/constants");

const endpoints = {
	"POST /system/postnotice": {
		action: require("./actions/notice"),
		permRequired: PERMISSIONS.system.notice.create,
	},
	"POST /system/clearnotice": {
		action: require("./actions/clearnotice"),
		permRequired: PERMISSIONS.system.notice.clear,
	},
	"GET /system/notice": {
		action: require("./actions/readNotice"),
		permRequired: PERMISSIONS.access
	}
};

exports.handler = errorHandler(async (event, context) => {
	console.log("System Manager:", { httpMethod: event.httpMethod, path: event.path });
	logAction(FUNC_NAMES.SYS_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? "[none]",
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

	if (event.body && typeof event.body === 'string' || event.body instanceof String) {
		try {
			event.parsedBody = JSON.parse(event.body);
		} catch (e) {
			console.warn("Failed to parse event body. Event body: ", event.body);
			event.parsedBody = event.body;
		}
	}

	logAction(FUNC_NAMES.SYS_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? "[none]",
		action: "invoke-action",
		status: 'permission-validated',
		resource: routeKey,
		details: { context, event }
	});

	// Execute action
	return action.action.handle(event, context);
});
