/**
 * Manage players on the server (ban, mute, etc)
 */

const { PERMISSIONS } = require("../shared/permissionValues");
const { getInstanceStatus } = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { validateResourceAccess, getUserSub, validatePermission } = require("../shared/utils/permissions");
const { errorResponse, notFoundError, successResponse } = require("../shared/utils/response");
const { callTShockAPI } = require("./tshockApi");

async function handle(event) {
	const serverId = event.pathParameters?.id;
	const { resource } = event;
	const action = resource.split("/").pop();
	const { playerID, reason, banStart, banEnd } = event.body;

	if (!serverId) {
		return notFoundError("Server ID");
	}

	if (!playerID) {
		return notFoundError("Player ID");
	}

	await validateResourceAccess(event, `server::${serverId}`);

	switch (action) {
		case "ban":
			await validatePermission(event, PERMISSIONS.server.player.ban);
			break;
		case "kick":
			await validatePermission(event, PERMISSIONS.server.player.kick);
			break;
		case "kill":
			await validatePermission(event, PERMISSIONS.server.player.kill);
			break;
		case "mute":
			await validatePermission(event, PERMISSIONS.server.player.mute);
			break;
		default:
			return errorResponse("Invalid action " + action);
	}

	try {
		// For now, treat serverId as the EC2 instance ID to obtain IP
		const instance = await getInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === 'PENDING') {
			return errorResponse(`Instance ${serverId} has no reachable public IP`, 503, 'INSTANCE_IP_UNAVAILABLE');
		}

		const status = await callTShockAPI(getUserSub(event), ip, "/v2/server/status", { players: true, rules: true });

		let result;

		switch (action) {
			case "ban":
				result = await callTShockAPI(getUserSub(event), ip, "/v3/bans/create", { identifier: playerID, reason, start: banStart, end: banEnd });
				break;
			case "kick":
				result = await callTShockAPI(getUserSub(event), ip, "/v2/players/kick", { player: playerID, reason });
				break;
			case "kill":
				result = await callTShockAPI(getUserSub(event), ip, "/v2/players/kill", { identifier: playerID, from: reason });
				break;
			case "mute":
				result = await callTShockAPI(getUserSub(event), ip, "/v2/players/mute", { player: playerID });
				break;
			default:
				return errorResponse("Invalid action " + action);
		}

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: getUserSub(event) ?? 'unknown',
			action: `${action}-player`,
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { action, serverId, result }
		});

		return successResponse({ success: true });
	} catch (err) {
		return errorResponse(err.message || 'Failed to fetch perform user management action');
	}
}

module.exports = {handle};
