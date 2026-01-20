/**
 * Send a config reload request to TShock
 */

const { FUNC_NAMES } = require("../shared/constants");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { validateResourceAccess } = require("../shared/utils/permissions");
const {successResponse, errorResponse, validationError,} = require("../shared/utils/response");
const { callTShockAPI } = require("./tshockApi");

async function handle(event) {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return validationError("Server ID is required");
	}

	await validateResourceAccess(event, `server::${serverId}`);

	logAction(FUNC_NAMES.SERV_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: "reload-config",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { serverId }
	});

	try {
		// For now, treat serverId as the EC2 instance ID to obtain IP
		const instance = await getInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === 'PENDING') {
			return errorResponse(`Instance ${serverId} has no reachable public IP`, 503, 'INSTANCE_IP_UNAVAILABLE');
		}

		const result = await callTShockAPI(event.requestContext?.authorizer?.claims?.sub, ip, "/v3/server/reload");
	} catch (e) {
		return errorResponse(e.message || 'Failed to fetch server status');
	}

	return successResponse({ });
}

module.exports = {handle};
