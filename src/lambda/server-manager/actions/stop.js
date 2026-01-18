/**
 * Stop the running tshock server
 */

const { FUNC_NAMES } = require("../shared/constants");
const { getInstanceStatus } = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { validateResourceAccess } = require("../shared/utils/permissions");
const {successResponse, errorResponse} = require("../shared/utils/response");
const {callTShockAPI} = require("./tshockApi");

async function handle(event) {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return notFoundError("Server ID");
	}

	await validateResourceAccess(event, `server::${serverId}`);

	try {
		// For now, treat serverId as the EC2 instance ID to obtain IP
		const instance = await getInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === "PENDING") {
			return errorResponse(`Instance ${serverId} has no reachable public IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		const result = await callTShockAPI(event.requestContext?.authorizer?.claims?.sub, ip, "/v2/server/off", { confirm: true, message: "Server stopping..." });
		
		logAction(FUNC_NAMES.SERV_MGR, {
			userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
			action: "stop",
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { ip, instanceId: serverId, result }
		});

		return successResponse({ server: result });
	} catch (err) {
		return errorResponse(err.message || "Failed to shut down server");
	}
}

module.exports = {handle};
