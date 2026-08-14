import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { InstanceState } from "../shared/aws/EC2.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { TShockAPI } from "../shared/utils/tshock/TShockAPI.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Assert } from "../shared/utils/core/Assert.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { SYSTEM_TABLE, WORLD_CREATE_KEY } from "../shared/vars.js";
import type { AutoShutoffStateEntry, SystemWorldCreateEntry } from "../shared/schema/SystemTable.js";
import { readShutdownState } from "../shared/utils/jobs/ShutdownJob.js";

/**
 * `?fields=players` — the slim variant, for a refetch that only needs the roster.
 *
 * `server.players` fires on every join and leave, so this is the highest-frequency read in the system
 * and the only one whose cost scales with how busy the game is rather than with how many people are
 * using the site. The full response is an EC2 describe, three Dynamo reads and a TShock round trip;
 * answering "who is online" needs the describe (for the private IP) and the TShock call, and nothing
 * else. So the slim path drops the shutdown-job, auto-shutoff and worldgen reads, asks TShock for
 * players without rules, and returns a strict subset of the full `server` object.
 *
 * An unrecognized value falls through to the **full** response rather than erroring. A client that
 * receives more than it asked for still works, whereas rejecting the value would break a newer
 * frontend against an older lambda — the same forward-compatibility choice the socket makes when it
 * ignores an event type it doesn't know.
 */
const PLAYERS_ONLY = "players";

export const getStatus = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return ResponseUtil.ValidationError("ServerID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverId}`);

	const playersOnly = event.queryStringParameters?.fields === PLAYERS_ONLY;

	try {
		const ec2 = new Ec2Dao();
		// Not skippable on either path: the private IP is the only way to reach the REST server.
		const ec2Instance = await ec2.GetInstanceStatus(serverId);
		const ip = ec2Instance.privateIp;
		const DB = new DynamoDao();

		// The shutdown block has to ride this endpoint too, not just instance-manager's: serverStore
		// overwrites its whole `instanceStatusData[id]` entry from this response, so if only the other
		// endpoint carried it, simply visiting the Server page would wipe the flag out from under the
		// tracker and the guards. The slim path is safe here only because it deliberately omits
		// `instance` entirely and the client merges rather than overwrites — see fetchPlayerList.
		// privateIp is destructured off rather than spread through: it's only ever an input to the
		// TShock REST path, the client has no use for it, and this response goes to the browser.
		let full: { instance: Record<string, any>; autoShutoff: Record<string, any> | null } | null = null;
		if (!playersOnly) {
			const { privateIp: _privateIp, ...clientInstance } = ec2Instance;
			const instance = { ...clientInstance, shutdown: await readShutdownState(serverId) };
			const autoShutoffState = await DB.GetItem(SYSTEM_TABLE, `autoshutoff#${serverId}`) as AutoShutoffStateEntry | null;
			const autoShutoff = autoShutoffState
				? {
					scheduledShutdownAt: autoShutoffState.scheduledShutdownAt ?? null,
					pauseUntilAt: autoShutoffState.pauseUntilAt ?? null,
					sequenceStage: autoShutoffState.sequenceStage ?? null,
				}
				: null;
			full = { instance, autoShutoff };
		}

		/**
		 * The REST server is not reachable. On the slim path that is a complete answer rather than a
		 * missing one — a server that isn't running has nobody on it — so the shape stays identical to
		 * a successful roster read and the client's merge needs no special case.
		 */
		const unreachable = () => playersOnly
			? ResponseUtil.Success({ server: { status: false, playercount: 0, players: [] }, partial: PLAYERS_ONLY })
			: ResponseUtil.Success({ server: { status: false }, ...(full ?? {}) });

		if (ip === "PENDING") {
			return unreachable();
		}

		if (!ip) {
			return ResponseUtil.Error(`Instance ${serverId} has no reachable private IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		if (ec2Instance.state !== InstanceState.RUNNING) {
			return unreachable();
		}

		// Skipped on the slim path: a third Dynamo read to predict an answer TShock is about to give us
		// anyway, since a world being generated means no REST server and therefore no players.
		if (!playersOnly) {
			const createWorldStatus = await DB.GetItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${serverId}`) as SystemWorldCreateEntry;

			if (createWorldStatus) {
				return unreachable();
			}
		}

		const userId = Parsers.GetUserSub(event);
		const tshock = new TShockAPI(ip);
		Assert.IsTruthyString(userId, "No user ID");
		// `players: true` already returns the roster the UI renders. There used to be a second call to
		// /v2/players/list here whose result nothing ever read — a wasted round trip to the game server
		// on every status read, on a box that is sometimes single-core.
		const status = await tshock.APIRequest(
			userId!,
			"/v2/server/status",
			playersOnly ? { players: true } : { players: true, rules: true },
		);

		if (playersOnly) {
			// Deliberately unlogged. This is a read, it fires per join and leave per operator, and the
			// full-status log below already records every page load; a CloudWatch write per player
			// event is the same class of per-activity cost the slim path exists to remove.
			return ResponseUtil.Success({
				server: { status: status.status, playercount: status.playercount, players: status.players },
				partial: PLAYERS_ONLY,
			});
		}

		await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userId,
			action: "get-status",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { ip, instanceId: serverId, status },
		});

		return ResponseUtil.Success({ server: status, ...(full ?? {}) });
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to fetch server status");
	}
};