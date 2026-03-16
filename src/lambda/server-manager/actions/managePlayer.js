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

function addBanIdentifier(identifiers, prefix, value) {
	if (value === undefined || value === null) {
		return;
	}

	const normalizedValue = String(value).trim();
	if (!normalizedValue) {
		return;
	}

	const identifier = `${prefix}${normalizedValue}`;
	if (!identifiers.includes(identifier)) {
		identifiers.push(identifier);
	}
}

function normalizeOptionalBoolean(value, defaultValue = true) {
	if (value === undefined || value === null) {
		return defaultValue;
	}

	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'string') {
		const normalizedValue = value.trim().toLowerCase();
		if (['true', '1', 'yes', 'y', 'on'].includes(normalizedValue)) {
			return true;
		}

		if (['false', '0', 'no', 'n', 'off'].includes(normalizedValue)) {
			return false;
		}
	}

	return defaultValue;
}

function buildBanIdentifiers(playerDetails, fallbackPlayerID, includeIpBan) {
	const identifiers = [];

	addBanIdentifier(identifiers, 'acc:', playerDetails?.username ?? playerDetails?.account ?? playerDetails?.user);
	addBanIdentifier(identifiers, 'uuid:', playerDetails?.uuid ?? playerDetails?.UUID);
	if (includeIpBan) {
		addBanIdentifier(identifiers, 'ip:', playerDetails?.ip);
	}
	addBanIdentifier(identifiers, 'name:', playerDetails?.nickname ?? playerDetails?.name ?? fallbackPlayerID);

	return identifiers;
}

async function handle(event) {
	const serverId = event.pathParameters?.id;
	const { resource } = event;
	const action = resource.split("/").pop();
	const { playerID, reason, banStart, banEnd, includeIpBan: includeIpBanRaw } = event.parsedBody;
	const includeIpBan = normalizeOptionalBoolean(includeIpBanRaw, true);

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
				{
					const playerDetails = await callTShockAPI(getUserSub(event), ip, "/v4/players/read", { player: resolvedPlayerID });
					const banIdentifiers = buildBanIdentifiers(playerDetails, playerID, includeIpBan);

					if (banIdentifiers.length === 0) {
						return errorResponse(`Unable to resolve a valid TShock ban identifier for player ${playerID}`, 500, 'BAN_IDENTIFIER_UNRESOLVED');
					}

					const banResults = [];
					for (const identifier of banIdentifiers) {
						const banResult = await callTShockAPI(getUserSub(event), ip, "/v3/bans/create", {
							identifier,
							reason,
							start: banStart,
							end: banEnd,
						});

						banResults.push({ identifier, result: banResult });
					}

					result = {
						resolvedPlayerID,
						banIdentifiers,
						banResults,
					};
				}
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
			details: { action, serverId, playerID, resolvedPlayerID, includeIpBan, result }
		});

		return successResponse({ success: true });
	} catch (err) {
		return errorResponse(err.message || 'Failed to fetch perform user management action');
	}
}

module.exports = {handle};
