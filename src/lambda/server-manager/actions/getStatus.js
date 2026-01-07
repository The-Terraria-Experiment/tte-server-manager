/**
 * Get specific server status via TShock REST API
 */

const {callTShockAPI} = require("./tshockApi");
const {successResponse, notFoundError, errorResponse} = require("../shared/utils/response");
const {getInstanceStatus} = require("../shared/utils/aws");

async function handle(event) {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return notFoundError("Server ID");
	}

	try {
		// For now, treat serverId as the EC2 instance ID to obtain IP
		const instance = await getInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === 'PENDING') {
			return errorResponse(`Instance ${serverId} has no reachable public IP`, 503, 'INSTANCE_IP_UNAVAILABLE');
		}

		// Call TShock API /v2/server/status on port 3891
		const status = await callTShockAPI(ip, "/v2/server/status");

		return successResponse({server: status});
	} catch (err) {
		return errorResponse(err.message || 'Failed to fetch server status');
	}
}

module.exports = {handle};
