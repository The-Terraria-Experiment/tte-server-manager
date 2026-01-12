/**
 * Stop the running tshock server
 */

const { FUNC_NAMES } = require("../shared/constants");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const {successResponse} = require("../shared/utils/response");
const {callTShockAPI} = require("./tshockApi");

async function handle(event) {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return notFoundError("Server ID");
	}

	try {
		// For now, treat serverId as the EC2 instance ID to obtain IP
		const instance = await getInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === "PENDING") {
			return errorResponse(`Instance ${serverId} has no reachable public IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		const result = await callTShockAPI(event.request.userAttributes.sub, ip, "/v2/server/off", { confirm: true, message: "Server stopping..." });
		
		logAction(FUNC_NAMES.SERV_MGR, {
			userId: event.request.userAttributes.sub ?? 'unknown',
			action: "stop",
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { ip, instanceId: serverId, result }
		});

		return successResponse({ server: result });
	} catch (err) {
		return errorResponse(err.message || "Failed to shut down server");
	}

	return successResponse({});
}

module.exports = {handle};
