import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao, InstanceState, type MultiInstanceStatus } from "../shared/aws/EC2.js";
import { PERMISSIONS } from "../shared/permissionValues.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { InstanceRegistry } from "../shared/utils/instance/InstanceRegistry.js";
import { TShockAPI } from "../shared/utils/tshock/TShockAPI.js";

/**
 * The whole fleet in one read, for the Overview page's at-a-glance card grid.
 *
 * This is a *summary* endpoint, deliberately not a batched `GET /server/{id}/status`. It carries no
 * shutdown-job block, no auto-shutoff countdown and no TShock rules, which is what keeps it to one
 * EC2 describe plus one REST round trip per running instance. The frontend stores it under its own
 * key for exactly that reason — a payload without `shutdown` must never reach `instanceStatusData`,
 * which `fetchServerStatus` assigns wholesale.
 *
 * The cost that matters is the fan-out: every running instance the caller can see is one round trip
 * through `tshock-proxy` to a box that is sometimes single-core. That is why the Overview page
 * fetches this on mount and on an explicit refresh only, and never polls it.
 */

/**
 * Wall clock for the whole fan-out, sized against **API Gateway's 29s integration timeout** rather
 * than the lambda's own — the same reasoning as `SYNC_POLL_BUDGET_MS`, `METRICS_READ_BUDGET_MS` and
 * `REMOVE_BUDGET_MS`. Each leg is already bounded at 5s inside the proxy (plus up to 5s to mint a
 * token on a cold container), and the legs run in parallel, so this only bites on a large fleet
 * where several proxy containers cold-start at once. Overrunning it would 504 the whole page over
 * one slow box, so a leg that misses the deadline reports itself instead.
 */
const OVERVIEW_BUDGET_MS = 18000;

/** Why a server block says what it says. `ok` is the only value that can carry live numbers. */
type Reachability = "ok" | "offline" | "timeout" | "error";

interface FleetServerStatus {
	online: boolean;
	reachable: Reachability;
	name: string | null;
	world: string | null;
	playercount: number;
	maxplayers: number | null;
	players: unknown[];
	uptime: string | null;
	serverversion: string | null;
	tshockversion: string | null;
}

interface FleetInstance {
	id: string;
	name: string;
	state: string;
	launchTime: Date | undefined;
	instanceType: string | undefined;
	server: FleetServerStatus | null;
}

/** A server we could not get numbers out of. Never `online`, and never carrying a stale count. */
const noStatus = (reachable: Reachability): FleetServerStatus => ({
	online: false,
	reachable,
	name: null,
	world: null,
	playercount: 0,
	maxplayers: null,
	players: [],
	uptime: null,
	serverversion: null,
	tshockversion: null,
});

const TIMED_OUT = Symbol("tshock-read-timeout");

/**
 * Races a leg against the remaining fleet budget. `work` is required never to reject: once the race
 * has settled on the timeout, a later rejection would have nothing left listening to it and would
 * surface as an unhandled rejection.
 */
const withBudget = async <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<typeof TIMED_OUT>((resolve) => {
				timer = setTimeout(() => resolve(TIMED_OUT), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

/**
 * One instance's TShock status. Never throws — a fleet view must not lose every card because one
 * box is wedged.
 */
const readServerStatus = async (instance: MultiInstanceStatus, userId: string): Promise<FleetServerStatus> => {
	let raw: Record<string, any>;
	try {
		raw = await new TShockAPI(instance.privateIp).APIRequest(userId, "/v2/server/status", { players: true });
	} catch {
		return noStatus("error");
	}

	/**
	 * Not a truthiness check. On a refused connection `APIRequest` returns an APIGatewayProxyResult
	 * sentinel (`{ statusCode, headers, body }`) rather than TShock JSON — a long-standing contract
	 * every "is the server up?" caller reads. Comparing the mirrored body-level `status` to "200"
	 * answers both shapes without a special case, and is the same check `serverStore` makes.
	 */
	if (String(raw?.status) !== "200") {
		return noStatus("offline");
	}

	return {
		online: true,
		reachable: "ok",
		name: raw.name ?? null,
		world: raw.world ?? null,
		playercount: raw.playercount ?? 0,
		maxplayers: raw.maxplayers ?? null,
		players: raw.players ?? [],
		uptime: raw.uptime ?? null,
		serverversion: raw.serverversion ?? null,
		tshockversion: raw.tshockversion ?? null,
	};
};

export const getFleetOverview = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const userId = Parsers.GetUserSub(event);
	if (!userId) {
		return ResponseUtil.Error("Unauthorized: No user context", 401, "UNAUTHORIZED");
	}

	const instanceIds = await InstanceRegistry.GetRegisteredInstanceIds();
	const ec2 = new Ec2Dao();
	const instancesData = await ec2.GetMultipleInstanceStatus(instanceIds);

	/**
	 * Filtered server-side, unlike `GET /instances`, which returns the whole environment and lets the
	 * client drop what it can't reach. There is no picker here to filter — the page renders one card
	 * per entry — so an instance the caller has no access to has no business being in the payload.
	 * `CheckResourceAccess` is the non-throwing variant; a denied instance is an omission, not a 403.
	 */
	const visible: MultiInstanceStatus[] = [];
	for (const instanceData of instancesData) {
		if (await Permissions.CheckResourceAccess(userId, `instance::${instanceData.id}`)) {
			visible.push(instanceData);
		}
	}

	// One cached lookup for the action permission, then one per instance for the resource token.
	const canReadServers = await Permissions.CheckPermission(userId, PERMISSIONS.server.status.read);

	const deadline = Date.now() + OVERVIEW_BUDGET_MS;
	const instances: FleetInstance[] = await Promise.all(
		visible.map(async (instanceData): Promise<FleetInstance> => {
			// privateIp is never spread through: it is only ever an input to the REST path, and this
			// response goes to the browser.
			const base = {
				id: instanceData.id,
				name: instanceData.name,
				state: instanceData.state,
				launchTime: instanceData.launchTime,
				instanceType: instanceData.instanceType,
			};

			const reachable =
				canReadServers &&
				instanceData.state === InstanceState.RUNNING &&
				Boolean(instanceData.privateIp) &&
				instanceData.privateIp !== "PENDING" &&
				instanceData.privateIp !== "UNKNOWN" &&
				(await Permissions.CheckResourceAccess(userId, `server::${instanceData.id}`));

			if (!reachable) {
				// A stopped instance genuinely has no server, and a caller without server access must
				// not be told the difference. Both read as "no server block" rather than an error.
				return { ...base, server: null };
			}

			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				return { ...base, server: noStatus("timeout") };
			}

			const outcome = await withBudget(readServerStatus(instanceData, userId), remaining);
			return { ...base, server: outcome === TIMED_OUT ? noStatus("timeout") : outcome };
		}),
	);

	const truncated = instances.some((instance) => instance.server?.reachable === "timeout");

	// One log line for the request, not one per instance — this fires on every landing-page load.
	await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId,
		action: "get-fleet-overview",
		status: truncated ? "truncated" : "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: {
			instanceCount: instances.length,
			online: instances.filter((instance) => instance.server?.online).length,
		},
	});

	return ResponseUtil.Success({ instances, truncated });
};
