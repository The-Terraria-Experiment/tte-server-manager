import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { TShockAPI } from "../shared/utils/tshock/TShockAPI.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { Assert } from "../shared/utils/core/Assert.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { isRefusedConnectionEnvelope, normalizeReport } from "../shared/utils/tshock/InventoryReport.js";

/**
 * The InventoryMonitor plugin's own cap on `/inventory/readall` (`ReadAllMaxPlayers`, defaults to
 * 255 on the plugin side). Mirrored here only so a capped response can say so rather than silently
 * looking like a complete capture — this file has no way to change the actual cap.
 */
const READALL_CAP = 255;

/**
 * Reads every online player's inventory in one call, for a point-in-time export.
 *
 * Uses the plugin's own `/inventory/readall` rather than looping `readPlayerInventory` per roster
 * name: one TShock round trip through tshock-proxy instead of one per player, and it reflects who is
 * online at the instant the plugin builds the response rather than whoever our own roster read said
 * a moment earlier. Same `invmonitor.rest.read` permission as `/inventory/read` — nothing new to
 * grant on the fleet.
 */
export const readAllPlayerInventories = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("ServerID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	try {
		const EC2 = new Ec2Dao();
		const instance = await EC2.GetInstanceStatus(serverID);
		const instanceIP = instance.privateIp;

		if (!instanceIP || instanceIP === "PENDING") {
			return ResponseUtil.Error(`Instance ${serverID} has no reachable private IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		const userID = Parsers.GetUserSub(event);
		Assert.IsTruthyString(userID, "No user ID");

		const TShock = new TShockAPI(instanceIP);
		const result = await TShock.APIRequest(userID!, "/inventory/readall", {
			include: "core,storage,misc,loadouts",
		});

		if (isRefusedConnectionEnvelope(result)) {
			return ResponseUtil.Error("The Terraria server is not responding", 503, "SERVER_UNREACHABLE");
		}

		// Lowercase top-level keys, PascalCase nested — the plugin's own convention, same as the
		// `player` wrapper on `/inventory/read`.
		const rawPlayers = (result.players ?? result.Players ?? []) as Record<string, any>[];
		const players = rawPlayers.map(raw => normalizeReport(raw));
		const truncated = players.length >= READALL_CAP;

		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "read-all-player-inventories",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			status: truncated ? "truncated" : "ok",
			details: { serverID, playerCount: players.length },
		});

		return ResponseUtil.Success({ players, truncated });
	} catch (e: any) {
		CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "read-all-player-inventories",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			error: e?.message ?? "unknown",
			stack: new Error().stack,
			details: { serverID },
		});

		return ResponseUtil.Error(e?.message || "Failed to read player inventories");
	}
};
