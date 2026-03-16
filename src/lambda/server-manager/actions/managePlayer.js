/**
 * Manage players on the server (ban, mute, etc)
 */

const { FUNC_NAMES } = require("../shared/constants");
const { getInstanceStatus } = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { validateResourceAccess, getUserSub, validatePermission } = require("../shared/utils/permissions");
const { errorResponse, notFoundError, successResponse } = require("../shared/utils/response");
const { callTShockAPI } = require("./tshockApi");

function normalizePlayerValue(value) {
	if (value === undefined || value === null) {
		return '';
	}
	return String(value).trim().toLowerCase();
}

function extractPlayerIdentifier(player) {
	if (!player || typeof player !== 'object') {
		return null;
	}

	const candidate = player.index ?? player.id ?? player.identifier ?? player.player ?? player.slot ?? player.whoAmI;
	if (candidate === undefined || candidate === null) {
		return null;
	}

	return String(candidate);
}

function resolvePlayerIdentifier(inputPlayer, playersResponse) {
	const players = playersResponse?.players;
	const normalizedInput = normalizePlayerValue(inputPlayer);

	if (!Array.isArray(players) || !normalizedInput) {
		return String(inputPlayer);
	}

	for (const player of players) {
		const identifier = extractPlayerIdentifier(player);
		if (identifier && normalizePlayerValue(identifier) === normalizedInput) {
			return identifier;
		}
	}

	for (const player of players) {
		const identifier = extractPlayerIdentifier(player);
		if (!identifier) {
			continue;
		}

		const names = [
			player.nickname,
			player.name,
			player.displayName,
			player.username,
			player.user,
			player.account,
		];

		if (names.some((name) => normalizePlayerValue(name) === normalizedInput)) {
			return identifier;
		}
	}

	return String(inputPlayer);
}

async function handle(event) {
	const serverId = event.pathParameters?.id;
	const { resource } = event;
	const action = resource.split("/").pop();
	const { playerID, reason, banStart, banEnd } = event.parsedBody;

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

		const playerList = await callTShockAPI(getUserSub(event), ip, "/v2/players/list");
		const resolvedPlayerID = resolvePlayerIdentifier(playerID, playerList);

		let result;

		switch (action) {
			case "ban":
				result = await callTShockAPI(getUserSub(event), ip, "/v3/bans/create", { identifier: resolvedPlayerID, reason, start: banStart, end: banEnd });
				break;
			case "kick":
				result = await callTShockAPI(getUserSub(event), ip, "/v2/players/kick", { player: resolvedPlayerID, reason });
				break;
			case "kill":
				result = await callTShockAPI(getUserSub(event), ip, "/v2/players/kill", { player: resolvedPlayerID, from: reason });
				break;
			case "mute":
				result = await callTShockAPI(getUserSub(event), ip, "/v2/players/mute", { player: resolvedPlayerID });
				break;
			default:
				return errorResponse("Invalid action " + action);
		}

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: getUserSub(event) ?? 'unknown',
			action: `${action}-player`,
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { action, serverId, playerID, resolvedPlayerID, result }
		});

		return successResponse({ success: true });
	} catch (err) {
		return errorResponse(err.message || 'Failed to fetch perform user management action');
	}
}

module.exports = {handle};
