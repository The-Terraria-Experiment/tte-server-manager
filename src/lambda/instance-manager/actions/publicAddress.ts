import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { GlobalAcceleratorDao } from "../shared/aws/GlobalAccelerator.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import { InstanceRegistry } from "../shared/utils/instance/InstanceRegistry.js";
import { publicAddressGroupArn, readPublicAddress } from "../shared/utils/instance/PublicAddress.js";
import { Realtime } from "../shared/utils/realtime/RealtimePublisher.js";
import { TShockAPI } from "../shared/utils/tshock/TShockAPI.js";

/** Returned when someone is connected to the box being switched away from, and `force` wasn't sent. */
export const PLAYERS_CONNECTED_CODE = "PLAYERS_CONNECTED";

/** `GET /instances/public-address`: which instance the play address reaches right now. */
export const readPublicAddressAction = async (event: AuthorizedEvent, context: Context) => {
	void event;
	void context;

	try {
		return ResponseUtil.Success(await readPublicAddress());
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to read the public address", 502, "PUBLIC_ADDRESS_READ_FAILED");
	}
};

/**
 * How many players are on `instanceId`, or null if that couldn't be established. A stopped box, or a
 * running one whose server refuses the connection, has nobody on it — that is an answer, not a failure.
 */
const countPlayers = async (instanceId: string, userId: string): Promise<number | null> => {
	try {
		const status = await new Ec2Dao().GetInstanceStatus(instanceId);
		if (status.state !== InstanceState.RUNNING || !status.privateIp || status.privateIp === "PENDING") {
			return 0;
		}

		const raw = await new TShockAPI(status.privateIp).APIRequest(userId, "/v2/server/status", { players: true });
		// A refused connection comes back as an APIGatewayProxyResult sentinel, not REST JSON.
		if (raw?.statusCode !== undefined || String(raw?.status) !== "200") {
			return 0;
		}
		return Number(raw.playercount ?? (Array.isArray(raw.players) ? raw.players.length : 0)) || 0;
	} catch {
		return null;
	}
};

/**
 * `POST /instance/{id}/public-address` (`{ force?: boolean }`): points the play address at this
 * instance, and only this instance.
 *
 * Switching drops every connection to the box it moves away from, so when anyone is on it (or we
 * couldn't tell) this answers 409 `PLAYERS_CONNECTED` with the count instead, and the UI asks for a
 * confirm and re-sends with `force`. Returned rather than thrown, for the same reason
 * `blockIfShutdownInProgress` returns: a throw reaches the client as a 500 with no code.
 */
export const routePublicAddressAction = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const userId = Parsers.GetUserSub(event);
	if (!userId) {
		return ResponseUtil.Error("Unauthorized: No user context", 401, "UNAUTHORIZED");
	}

	const groupArn = publicAddressGroupArn();
	if (!groupArn) {
		return ResponseUtil.Error("The public address isn't configured for this environment", 409, "PUBLIC_ADDRESS_NOT_CONFIGURED");
	}

	// Pointing players at a box that is being torn down would send them to nothing.
	const blocked = await blockIfShutdownInProgress(instanceId);
	if (blocked) return blocked;

	if (!(await InstanceRegistry.GetRegisteredInstanceIds()).includes(instanceId)) {
		return ResponseUtil.Error("Only an instance registered to this environment can be the public address", 409, "INSTANCE_NOT_REGISTERED");
	}

	const force = event.parsedBody?.force === true;

	try {
		const before = await readPublicAddress();
		if (!before.configured) {
			return ResponseUtil.Error("The public address isn't configured for this environment", 409, "PUBLIC_ADDRESS_NOT_CONFIGURED");
		}

		if (before.targetInstanceId === instanceId && !before.mixed) {
			return ResponseUtil.Success({ changed: false, publicAddress: before });
		}

		const leaving = before.targets.map(target => target.instanceId).filter(id => id !== instanceId);
		if (!force && leaving.length) {
			const counts = await Promise.all(leaving.map(id => countPlayers(id, userId)));
			const unknown = counts.some(count => count === null);
			const playercount = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);

			if (unknown || playercount > 0) {
				return ResponseUtil.Error(
					unknown
						? "Couldn't check who is connected to the current server. Switching would disconnect anyone on it."
						: `${playercount} player${playercount === 1 ? " is" : "s are"} connected to the current server and would be disconnected.`,
					409,
					PLAYERS_CONNECTED_CODE,
					{ playercount: unknown ? null : playercount, currentTargetIds: leaving },
				);
			}
		}

		await new GlobalAcceleratorDao().RouteAllTrafficTo(groupArn, instanceId);

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId,
			action: "route-public-address",
			status: "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { instanceId, previousTargets: before.targets.map(t => t.instanceId), force },
		});

		// After the write, never before: the client reacts by refetching.
		await Realtime.PublishPublicAddress(instanceId);

		return ResponseUtil.Success({ changed: true, publicAddress: await readPublicAddress() });
	} catch (error: any) {
		// GA's own validation errors (wrong region, instance not in a VPC with an internet gateway)
		// are the useful part, so they're passed through.
		return ResponseUtil.Error(error?.message || "Failed to switch the public address", 502, "PUBLIC_ADDRESS_SWITCH_FAILED");
	}
};
