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

/**
 * Slot as the InventoryMonitor plugin reports it. `slot` is the index *within* the container;
 * `globalSlot` is the 0-349 TShock NetItem index. The plugin only emits occupied slots, so the
 * client builds each grid at its known fixed size and indexes items in by `slot` rather than
 * mapping over this array.
 */
type InventorySlotEntry = {
	slot: number,
	globalSlot: number,
	netId: number,
	name: string,
	stack: number,
	prefix: number,
	prefixName: string | null,
	favorited: boolean,
};

type InventoryContainer = {
	name: string,
	group: string,
	items: InventorySlotEntry[],
};

type InventoryBuff = {
	id: number,
	name: string,
	ticksRemaining: number,
	secondsRemaining: number,
};

type InventoryReport = {
	index: number,
	name: string,
	serverSideCharacter: boolean,
	stats: { life: number, lifeMax: number, mana: number, manaMax: number },
	buffs: InventoryBuff[],
	containers: InventoryContainer[],
};

/**
 * The plugin's models are C# properties (`Slot`, `NetId`, `PrefixName`), and whether they reach us
 * PascalCased depends on the serializer settings of whatever TShock build is running — which is not
 * ours to pin. Reading both casings here means the frontend gets one stable camelCase contract
 * regardless, instead of every component having to guess.
 */
const pick = <T>(source: Record<string, any>, key: string, fallback: T): T => {
	const pascal = key.charAt(0).toUpperCase() + key.slice(1);
	const value = source[key] ?? source[pascal];
	return (value === undefined || value === null) ? fallback : value as T;
};

const normalizeReport = (raw: Record<string, any>): InventoryReport => {
	const stats = pick<Record<string, any>>(raw, "stats", {});

	return {
		index: pick(raw, "index", -1),
		name: pick(raw, "name", ""),
		serverSideCharacter: pick(raw, "serverSideCharacter", false),
		stats: {
			life: pick(stats, "life", 0),
			lifeMax: pick(stats, "lifeMax", 0),
			mana: pick(stats, "mana", 0),
			manaMax: pick(stats, "manaMax", 0),
		},
		buffs: pick<Record<string, any>[]>(raw, "buffs", []).map(buff => ({
			id: pick(buff, "id", 0),
			name: pick(buff, "name", ""),
			ticksRemaining: pick(buff, "ticksRemaining", 0),
			secondsRemaining: pick(buff, "secondsRemaining", 0),
		})),
		containers: pick<Record<string, any>[]>(raw, "containers", []).map(container => ({
			name: pick(container, "name", ""),
			group: pick(container, "group", ""),
			items: pick<Record<string, any>[]>(container, "items", []).map(item => ({
				slot: pick(item, "slot", -1),
				globalSlot: pick(item, "globalSlot", -1),
				netId: pick(item, "netId", 0),
				name: pick(item, "name", ""),
				stack: pick(item, "stack", 0),
				prefix: pick(item, "prefix", 0),
				prefixName: pick<string | null>(item, "prefixName", null),
				favorited: pick(item, "favorited", false),
			})),
		})),
	};
};

/**
 * `TShockAPI.APIRequest` answers a refused connection with an `APIGatewayProxyResult` rather than
 * TShock JSON — a long-standing contract the "is the server up?" callers rely on. A method typed as
 * returning TShock JSON can therefore hand back a response envelope, and passing that straight to
 * the client would surface as a nonsense body instead of an error.
 */
const isRefusedConnectionEnvelope = (result: Record<string, any>): boolean =>
	typeof result?.statusCode === "number" && typeof result?.body === "string";

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

		if (!inventory.containers.length) {
			// A player who genuinely exists always has containers, even if every slot is empty. An empty
			// list means the plugin isn't installed, or the REST group is missing `invmonitor.rest.read`
			// and TShock answered with a permission object rather than a report.
			return ResponseUtil.Error(
				`No inventory data returned for '${playerID}'. Check that the InventoryMonitor plugin is installed and the REST group has 'invmonitor.rest.*'.`,
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
