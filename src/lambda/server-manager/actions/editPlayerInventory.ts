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
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import { isRefusedConnectionEnvelope, normalizeReport, type InventoryReport } from "../shared/utils/tshock/InventoryReport.js";
import {
	clearScope,
	isClearScope,
	removeSlots,
	resolveRemovalTargets,
	type ClearScope,
	type ResolvedTarget,
	type SlotRemovalRequest,
} from "../shared/utils/tshock/InventoryEdit.js";

/**
 * Destroys items in a live player's inventory. Removal only — there is deliberately no path here that
 * adds or alters an item.
 *
 * The sequence is **read → verify → remove → re-read**, and each leg earns its place:
 *
 * - the *read* is what turns the operator's slot indices into known items, so the audit log can record
 *   what was actually destroyed rather than only where it used to be;
 * - the *verify* refuses any slot whose contents changed since the operator looked (see
 *   `resolveRemovalTargets`);
 * - the *re-read* is required because the plugin's `removed: true` precedes its own verification pass
 *   on a non-SSC server, so this response reports what is genuinely in the inventory now rather than
 *   what we asked for.
 *
 * Partial success is a **200 carrying an `outcome`**, not an error. `truncated`, `failed`,
 * `skippedEmpty` and `skippedChanged` are all results an operator needs to see and act on; collapsing
 * them into a 4xx/5xx would throw away which slots were affected at precisely the moment that matters.
 */

/** The plugin's `SlotMap.MaxSlot`. A request can't address more distinct slots than exist. */
const MAX_SLOT = 350;

const INCLUDE_ALL = "core,storage,misc,loadouts";

type EditOperation =
	| { op: "remove-slots", slots: SlotRemovalRequest[] }
	| { op: "clear", scope: ClearScope };

/**
 * Reads the player's current inventory, or an error response explaining why it couldn't.
 *
 * Both failure shapes are lifted from `readPlayerInventory` on purpose: an empty container list means
 * the plugin is missing or the REST group lacks `invmonitor.rest.*`, which is a very different fix
 * from the server being down, and an operator debugging a failed removal needs to be told which.
 */
async function readInventory(tshock: TShockAPI, userID: string, playerID: string): Promise<
	{ ok: true, inventory: InventoryReport } | { ok: false, response: APIGatewayProxyResult }
> {
	const result = await tshock.APIRequest(userID, "/inventory/read", {
		player: playerID,
		include: INCLUDE_ALL,
	});

	if (isRefusedConnectionEnvelope(result)) {
		return { ok: false, response: ResponseUtil.Error("The Terraria server is not responding", 503, "SERVER_UNREACHABLE") };
	}

	const rawReport = (result.player ?? result.Player ?? result) as Record<string, any>;
	const inventory = normalizeReport(rawReport);

	if (!inventory.containers.length) {
		return {
			ok: false,
			response: ResponseUtil.Error(
				`No inventory data returned for '${playerID}'. Check that the InventoryMonitor plugin is installed and the REST group has 'invmonitor.rest.*'.`,
				502,
				"INVENTORY_UNAVAILABLE",
			),
		};
	}

	return { ok: true, inventory };
}

/** Validates and narrows the request body. Returns a string describing the problem, or the operation. */
function parseOperation(body: any): EditOperation | string {
	const op = body?.op;

	if (op === "clear") {
		if (!isClearScope(body.scope)) {
			return "scope must be one of: all, main, core, storage, misc, loadouts";
		}
		return { op: "clear", scope: body.scope };
	}

	if (op !== "remove-slots") {
		return "op must be 'remove-slots' or 'clear'";
	}

	if (!Array.isArray(body.slots) || !body.slots.length) {
		return "slots must be a non-empty array";
	}
	if (body.slots.length > MAX_SLOT) {
		return `slots may not exceed ${MAX_SLOT} entries`;
	}

	const seen = new Set<number>();
	const slots: SlotRemovalRequest[] = [];

	for (const entry of body.slots) {
		const globalSlot = typeof entry === "number" ? entry : entry?.globalSlot;

		if (!Number.isInteger(globalSlot) || globalSlot < 0 || globalSlot >= MAX_SLOT) {
			return `Invalid slot '${globalSlot}': must be an integer from 0 to ${MAX_SLOT - 1}`;
		}
		// Duplicates are rejected rather than de-duplicated: the same slot twice in one request means
		// the caller built its list wrong, and silently collapsing it would hide that.
		if (seen.has(globalSlot)) {
			return `Duplicate slot '${globalSlot}'`;
		}
		seen.add(globalSlot);

		const netId = typeof entry === "number" ? undefined : entry?.netId;
		if (netId !== undefined && !Number.isInteger(netId)) {
			return `Invalid netId for slot '${globalSlot}'`;
		}

		slots.push(netId === undefined ? { globalSlot } : { globalSlot, netId });
	}

	return { op: "remove-slots", slots };
}

/** Trimmed for the audit log — the full report is 350 slots and none of the rest belongs in CloudWatch. */
const auditItem = (item: ResolvedTarget) => ({
	globalSlot: item.globalSlot,
	container: item.container,
	netId: item.netId,
	name: item.name,
	stack: item.stack,
	prefix: item.prefix,
});

export const editPlayerInventory = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	const playerID = event.pathParameters?.player;

	if (!serverID) {
		return ResponseUtil.ValidationError("ServerID is required");
	}
	if (!playerID) {
		return ResponseUtil.ValidationError("PlayerID is required");
	}

	const operation = parseOperation(event.parsedBody);
	if (typeof operation === "string") {
		return ResponseUtil.ValidationError(operation);
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	const blocked = await blockIfShutdownInProgress(serverID);
	if (blocked) {
		return blocked;
	}

	const userID = Parsers.GetUserSub(event);

	try {
		const EC2 = new Ec2Dao();
		const instance = await EC2.GetInstanceStatus(serverID);
		const instanceIP = instance.privateIp;

		if (!instanceIP || instanceIP === "PENDING") {
			return ResponseUtil.Error(`Instance ${serverID} has no reachable private IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		Assert.IsTruthyString(userID, "No user ID");

		const TShock = new TShockAPI(instanceIP);

		const before = await readInventory(TShock, userID!, playerID);
		if (!before.ok) {
			return before.response;
		}

		let outcome: Record<string, any>;
		let destroyed: ResolvedTarget[];

		if (operation.op === "clear") {
			// Recorded from the pre-clear read, because `/inventory/clear` reports only a count. Without
			// this the audit trail for the most destructive action available would be a number.
			destroyed = before.inventory.containers.flatMap(container => container.items.map(item => ({
				globalSlot: item.globalSlot,
				netId: item.netId,
				name: item.name,
				stack: item.stack,
				prefix: item.prefix,
				container: container.name,
			})));

			const cleared = await clearScope(instanceIP, userID!, playerID, operation.scope);
			if (cleared.unreachable) {
				return ResponseUtil.Error("The Terraria server is not responding", 503, "SERVER_UNREACHABLE");
			}

			outcome = {
				op: "clear",
				scope: cleared.scope,
				slotsCleared: cleared.slotsCleared,
				removed: [],
				failed: [],
				skippedEmpty: [],
				skippedChanged: [],
				truncated: false,
			};
		} else {
			const resolution = resolveRemovalTargets(before.inventory, operation.slots);
			const removal = await removeSlots(instanceIP, userID!, playerID, resolution.targets);

			if (removal.unreachable && !removal.removed.length) {
				return ResponseUtil.Error("The Terraria server is not responding", 503, "SERVER_UNREACHABLE");
			}

			destroyed = removal.removed;
			outcome = {
				op: "remove-slots",
				requested: operation.slots.length,
				removed: removal.removed,
				failed: removal.failed,
				skippedEmpty: resolution.skippedEmpty,
				skippedChanged: resolution.skippedChanged,
				truncated: removal.truncated,
				unreachable: removal.unreachable,
			};
		}

		// Authoritative post-state. The plugin answers `removed: true` before its own retry-verify pass
		// has run, and on a non-SSC server the client can put the item straight back — so what the
		// operator is shown next comes from a fresh read, never from assuming the removal stuck.
		const after = await readInventory(TShock, userID!, playerID);
		const inventory = after.ok ? after.inventory : before.inventory;

		// Unlike `readPlayerInventory`, which logs counts only, this records every destroyed item in
		// full. Irreversibly destroying someone's property is the exact thing an audit log is for.
		await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "edit-player-inventory",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			status: outcome.truncated ? "truncated" : "ok",
			details: {
				serverID,
				playerID,
				operation: outcome.op,
				scope: outcome.scope ?? null,
				destroyed: destroyed.map(auditItem),
				destroyedCount: destroyed.length,
				failed: outcome.failed,
				skippedEmpty: outcome.skippedEmpty,
				skippedChanged: outcome.skippedChanged,
				confirmReadFailed: !after.ok,
			},
		});

		return ResponseUtil.Success({ inventory, playerID, outcome });
	} catch (e: any) {
		CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "edit-player-inventory",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			error: e?.message ?? "unknown",
			stack: new Error().stack,
			details: { serverID, playerID, operation: operation.op },
		});

		return ResponseUtil.Error(e?.message || "Failed to edit player inventory");
	}
};
