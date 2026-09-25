import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Assert } from "../shared/utils/core/Assert.js";
import { TShockAPI } from "../shared/utils/tshock/TShockAPI.js";
import { isModdedItemKey } from "../shared/utils/tshock/InventoryReport.js";
import { blockIfUnsupported } from "../shared/utils/instance/ServerFlavor.js";

/**
 * `GET /server/{id}/items/names`: every modded item the running tModLoader server has loaded, as
 * `{ "<itemKey>": "<display name>" }`, so the item rules editor can search modded items.
 *
 * Vanilla names never come from here. They are in the static `names.json` beside the sprite atlas,
 * which works with every server stopped; only modded names are per-server, and only a running server
 * knows them. So this returns `modItems` alone and drops the vanilla `items` table the mod also sends.
 *
 * Deliberately unlogged and uncached: it is a read the editor makes when it opens, and the answer
 * changes whenever the mod set does.
 */
export const readModItemNames = async (event: AuthorizedEvent) => {
	const serverId = event.pathParameters?.id;
	if (!serverId) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverId}`);

	// Modded items only exist where mods do.
	const unsupported = await blockIfUnsupported(serverId, "mods");
	if (unsupported) return unsupported;

	try {
		const instance = await new Ec2Dao().GetInstanceStatus(serverId);
		const ip = instance.privateIp;
		if (instance.state !== InstanceState.RUNNING || !ip || ip === "PENDING") {
			return ResponseUtil.Success({ running: false, modItems: {} });
		}

		const userId = Parsers.GetUserSub(event);
		Assert.IsTruthyString(userId, "No user ID");
		const raw = await new TShockAPI(ip).APIRequest(userId!, "/inventory/itemnames");

		// A refused connection arrives as an APIGatewayProxyResult sentinel rather than REST JSON.
		if (raw?.statusCode !== undefined) {
			return ResponseUtil.Success({ running: false, modItems: {} });
		}
		if (String(raw?.status) !== "200") {
			return ResponseUtil.Error(
				raw?.error || "The server couldn't list its items. Is the TteInventoryMonitor mod installed?",
				502,
				"ITEM_NAMES_READ_FAILED",
			);
		}

		const modItems: Record<string, string> = {};
		for (const [key, name] of Object.entries(raw?.modItems ?? {})) {
			if (isModdedItemKey(key) && typeof name === "string") {
				modItems[key] = name;
			}
		}

		return ResponseUtil.Success({ running: true, modItems });
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to read item names");
	}
};
