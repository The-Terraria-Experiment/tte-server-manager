/**
 * Get specific server status via TShock REST API
 */

const {callTShockAPI} = require("./tshockApi");
const {successResponse, notFoundError, errorResponse} = require("../shared/utils/response");
const {getInstanceStatus} = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("../shared/constants");
const { validateResourceAccess, getUserSub } = require("../shared/utils/permissions");

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

		if (!ip || ip === 'PENDING') {
			return errorResponse(`Instance ${serverId} has no reachable public IP`, 503, 'INSTANCE_IP_UNAVAILABLE');
		}

		// Call TShock API /v2/server/status on port 3891
		const status = await callTShockAPI(getUserSub(event), ip, "/v2/server/status", { players: true, rules: true });

		const playerData = await callTShockAPI(getUserSub(event), ip, "/v2/players/list");

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: getUserSub(event) ?? 'unknown',
			action: "get-status",
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { ip, instanceId: serverId, status }
		});

		return successResponse({server: status, players: playerData});
	} catch (err) {
		return errorResponse(err.message || 'Failed to fetch server status');
	}
}

module.exports = {handle};
