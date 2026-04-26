import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/permissions.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { TShockAPI } from "../utils/TShockAPI.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { Assert } from "../shared/utils/Assert.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";

type PlayerSummary = { // Response from call to /v2/players/list
	nickname: string,
	username: string,
	group: string,
	active: boolean,
	state: number,
	team: number
};

type PlayerInventoryItem = {
	netID: number,
	prefix: number,
	stack: number,
	favorited: boolean
};

type PlayerData = { // Response from call to /v4/players/read
	status: string,			// HTTP code
	nickname: string,
	username: string,
	ip: string,				// IPv4
	group: string,
	registered: string,		// ISO string
	muted: boolean,
	position: string,		// "xxxx,yyyy"
	items: {
		inventory: PlayerInventoryItem[],
		equipment: any[],	// unknown
		dyes: any[],		// unknown
		piggy: any[],		// unknown
		safe: any[],		// unknown
		forge: any[],		// unknown
	},
	buffs: string			// 44 ints separated by ", "
};

const buildBanIdentifiers = (playerDetails: PlayerData, fallbackPlayerID: string, includeIpBan: boolean) => {
	const identifiers: Set<string> = new Set<string>();

	const add = (prefix: string, value: string) => {
		if (!value || !value.trim()) {
			return;
		}

		identifiers.add(`${prefix}${value.trim()}`);
	};

	add("acc:", playerDetails.username);
	add("uuid:", playerDetails.username);
	// add("uuid:", playerDetails.uuid); // Don't think this one actually exists
	add("name:", playerDetails.nickname ?? playerDetails.username);
	add("name:", fallbackPlayerID);
	if (includeIpBan) {
		add("ip:", playerDetails.ip);
	}

	return Array.from(identifiers);
}

export const managePlayer = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const serverID = event.pathParameters?.id;
	const { resource } = event;
	const action = resource.split("/").pop();
	const { playerID, reason, banStart, banEnd, includeIpBan } = (event.parsedBody || {});

	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}
	if (!playerID) {
		return ResponseUtil.ValidationError("Player ID is required");
	}
	if (!action) {
		return ResponseUtil.ValidationError("Action is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	try {
		const EC2 = new Ec2Dao();

		const instance = await EC2.GetInstanceStatus(serverID);
		const instanceIP = instance.publicIp;

		if (!instanceIP || instanceIP === 'PENDING') {
			return ResponseUtil.Error(`Instance ${serverID} has no reachable public IP`, 503, 'INSTANCE_IP_UNAVAILABLE');
		}

		const TShock = new TShockAPI(instanceIP);
		const userID = Parsers.GetUserSub(event);
		Assert.IsTruthyString(userID, "No user ID");
		let result;

		switch (action) {
			case "ban":
				const playerDetails = await TShock.APIRequest(userID!, "/v4/players/read", { player: playerID }) as PlayerData;
				const banIdentifiers = buildBanIdentifiers(playerDetails, playerID, includeIpBan);
				
				const banResults = [];
				for (const identifier of banIdentifiers) {
					try {
						const banResult = await TShock.APIRequest(userID!, "/v3/bans/create", {
							identifier,
							reason,
							start: banStart,
							end: banEnd
						});

						banResults.push({ identifier, result: banResult });
					} catch (e: any) {
						// For some reason, calling this endpoint likes to throw a 500, but it always seems to work? Seems tshock-y enough to me
						if (e.message === "TShock HTTP 500: TShock API error") {
							console.warn("TShock API 500 at /v3/bans/create");
						} else {
							throw e;
						}
					}
				}

				result = {
					playerID,
					banIdentifiers,
					banResults,
					playerDetails
				};
				break;
			case "kick":
				result = await TShock.APIRequest(userID!, "/v2/players/kick", { player: playerID, reason });
				break;
			case "kill":
				result = await TShock.APIRequest(userID!, "/v2/players/kill", { player: playerID, from: reason });
				break;
			case "mute":
				result = await TShock.APIRequest(userID!, "/v2/players/mute", { player: playerID });
				break;
			default:
				return ResponseUtil.Error(`Invalid action: ${action}`);
		}

		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: `${action}-player`,
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { action, serverID, playerID, includeIpBan, result }
		});

		return ResponseUtil.Success({ success: true });
	} catch (e: any) {
		CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "manage-player",
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			error: e.message,
			stack: new Error().stack,
			details: {
				params: event.parsedBody
			}
		});

		return ResponseUtil.Error("Failed to perform user management action");
	}
};
