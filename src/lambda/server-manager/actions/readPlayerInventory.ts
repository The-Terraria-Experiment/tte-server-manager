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
import { isPlayerFound, isRefusedConnectionEnvelope, normalizeReport } from "../shared/utils/tshock/InventoryReport.js";

export const readPlayerInventory = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	const playerID = event.pathParameters?.player;

	if (!serverID) {
		return ResponseUtil.ValidationError("ServerID is required");
	}
	if (!playerID) {
		return ResponseUtil.ValidationError("PlayerID is required");
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
		const result = await TShock.APIRequest(userID!, "/inventory/read", {
			player: playerID,
			include: "core,storage,misc,loadouts",
		});

		if (isRefusedConnectionEnvelope(result)) {
			return ResponseUtil.Error("The Terraria server is not responding", 503, "SERVER_UNREACHABLE");
		}

		// The plugin nests its report under `player`; older/other shapes put it at the top level.
		const rawReport = (result.player ?? result.Player ?? result) as Record<string, any>;
		const inventory = normalizeReport(rawReport);

		if (!isPlayerFound(inventory)) {
			// The plugin answers a bad player name with a RestObject carrying `error`, so quote it when
			// it's there — "not found" and "plugin missing" are different fixes and used to be reported
			// with the same message. Note an *empty* inventory is not this case: see `isPlayerFound`.
			const pluginError = typeof result?.error === "string" ? result.error : null;

			return ResponseUtil.Error(
				pluginError
					? `The InventoryMonitor plugin rejected the read for '${playerID}': ${pluginError}`
					: `No inventory data returned for '${playerID}'. Check that the InventoryMonitor plugin is installed and the REST group has 'invmonitor.rest.*'.`,
				502,
				"INVENTORY_UNAVAILABLE",
			);
		}

		// Deliberately counts, not the payload: a full report is 350 slots plus buffs, and none of it
		// is useful in an audit log. `readPlayer` logs its whole result; don't copy that here.
		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "read-player-inventory",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: {
				serverID,
				playerID,
				containerCount: inventory.containers.length,
				itemCount: inventory.containers.reduce((total, container) => total + container.items.length, 0),
				buffCount: inventory.buffs.length,
			},
		});

		return ResponseUtil.Success({ inventory, playerID });
	} catch (e: any) {
		CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "read-player-inventory",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			error: e?.message ?? "unknown",
			stack: new Error().stack,
			details: { serverID, playerID },
		});

		return ResponseUtil.Error(e?.message || "Failed to read player inventory");
	}
};
