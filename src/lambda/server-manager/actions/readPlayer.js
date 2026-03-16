/**
 * Get detailed information on a player
 */

const { getInstanceStatus } = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { validateResourceAccess, getUserSub, validatePermission } = require("../shared/utils/permissions");
const { errorResponse, notFoundError, successResponse } = require("../shared/utils/response");
const { callTShockAPI } = require("./tshockApi");

async function handle(event) {
	const serverId = event.pathParameters?.id;
	const playerID = event.pathParameters?.player;

	if (!serverId) {
		return notFoundError("Server ID");
	}

	if (!playerID) {
		return notFoundError("Player ID");
	}

	await validateResourceAccess(event, `server::${serverId}`);

	try {
		// For now, treat serverId as the EC2 instance ID to obtain IP
		const instance = await getInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === 'PENDING') {
			return errorResponse(`Instance ${serverId} has no reachable public IP`, 503, 'INSTANCE_IP_UNAVAILABLE');
		}

		const result = await callTShockAPI(getUserSub(event), ip, "/v4/players/read", { player: playerID });

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: getUserSub(event) ?? 'unknown',
			action: `read-player`,
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { playerID, serverId, result }
		});

		return successResponse({ result });
	} catch (err) {
		return errorResponse(err.message || 'Failed to read player');
	}
}

module.exports = {handle};
