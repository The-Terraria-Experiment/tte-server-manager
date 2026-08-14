import { CWLogger } from "../../aws/CloudWatch.js";
import { Ec2Dao, InstanceState } from "../../aws/EC2.js";
import { SsmDao, isSsmPollTimeout } from "../../aws/SSM.js";
import { CW_LOG_GENERAL } from "../../constants.js";
import { pollsUntilDeadline } from "../jobs/SyncBudget.js";
import { TShockAPI } from "./TShockAPI.js";
import { tshockProcessPattern } from "./TShockLaunch.js";
import { endServerSession } from "./ServerSession.js";

/**
 * The first leg of an instance shutdown: bring TShock down through its own save-and-exit path before
 * anything else touches the box.
 *
 * This has to run *before* the file sync, and that ordering is the whole point. Terraria holds the
 * world in memory and only writes it out on save; a shutdown that stopped the instance with the
 * server still running lost every change since the last autosave, and the sync behind it dutifully
 * uploaded the stale file over the good one in S3. Archiving the console logs after the stop is a
 * smaller bonus — the shutdown lines make it into the archived transcript.
 *
 * The stop goes through TShock's REST API rather than a signal, because `/v2/server/off?confirm=true`
 * is the only path that saves the world and exits cleanly; SIGTERM to the process is a crash from
 * Terraria's point of view. The wait for the process to actually disappear runs *on the box* as a
 * single SSM command rather than as a poll loop from here — one round trip instead of one per second,
 * on a path where the budget is measured against how long the instance stays reachable.
 */

const SHUTDOWN_USER_ID = "[shutdown]";

/** Message TShock shows connected players as it kicks them for the shutdown. */
const STOP_MESSAGE = "The server is shutting down.";

/** How often we ask SSM whether the on-box wait has finished. */
const EXIT_POLL_INTERVAL_MS = 2000;

/**
 * Wall-clock held back from the on-box wait for the SSM round trip around it: `SendCommand`, the
 * first poll's delay, and the result fetch. Without it the script would still be counting down when
 * our poll budget ran out, and every run would report a timeout it didn't have.
 */
const SSM_ROUND_TRIP_RESERVE_MS = 8000;

/**
 * Stops a running TShock server on `instanceId` and waits for the process to exit.
 *
 * Best-effort by the shutdown-task contract: every failure is logged and swallowed, because the
 * instance is going down either way and a server that could not be reached must not become a failed
 * shutdown. A no-op is the common case — the auto-shutoff path has already stopped the server minutes
 * earlier, and a box with no server running answers the REST call with a connection refusal.
 *
 * @param deadline Absolute epoch-ms to stop waiting, from the shutdown worker's per-task budget (see ShutdownTasks).
 */
export async function stopTShockServer(instanceId: string, deadline: number): Promise<void> {
	// Concatenated from env in vars.ts, so an unset var arrives as the literal "undefined:stage"
	// rather than a falsy value — check the raw var, exactly as TShockAPI does.
	if (!process.env.TSHOCK_PROXY_FUNCTION_ARN || !process.env.TSHOCK_API_PORT || !process.env.TSHOCK_SECRET_NAME) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "shutdown-stop-server",
			error: "Missing TShock env (TSHOCK_PROXY_FUNCTION_ARN/TSHOCK_API_PORT/TSHOCK_SECRET_NAME), skipping graceful server stop",
			details: {
				instanceId,
				hasProxyArn: !!process.env.TSHOCK_PROXY_FUNCTION_ARN,
				hasPort: !!process.env.TSHOCK_API_PORT,
				hasSecretName: !!process.env.TSHOCK_SECRET_NAME,
			},
		});
		return;
	}

	const ip = await resolvePrivateIp(instanceId);
	if (!ip) return;

	const accepted = await requestServerOff(instanceId, ip);
	if (!accepted) return;

	// Only on the accepted path: `false` means nothing was listening, which is the *normal* case on the
	// auto-shutoff route where the countdown stopped the server minutes ago. Closing a session here
	// would be closing one that something else already closed, dated to the wrong moment.
	await closeSession(instanceId);

	await waitForTShockExit(instanceId, deadline);
}

/** Best-effort by the shutdown-task contract: a session record must never fail a shutdown. */
async function closeSession(instanceId: string): Promise<void> {
	try {
		await endServerSession(instanceId, { endedBy: SHUTDOWN_USER_ID, reason: "shutdown" });
	} catch (error) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "shutdown-stop-server",
			error: error instanceof Error ? error.message : String(error),
			details: { instanceId, stage: "end-session" },
		});
	}
}

/**
 * The instance's private IP, or null when there is nothing to talk to.
 *
 * Private, never public: traffic sent to a public address from inside the VPC hairpins out through
 * the internet gateway and arrives with a public source address, which will not match the
 * source-security-group rule that keeps the REST port closed. It fails silently rather than loudly.
 */
async function resolvePrivateIp(instanceId: string): Promise<string | null> {
	try {
		const instance = await new Ec2Dao().GetInstanceStatus(instanceId);

		if (instance.state !== InstanceState.RUNNING) {
			// Already stopping or stopped — there is no server left to save.
			return null;
		}

		if (!instance.privateIp || instance.privateIp === "PENDING" || instance.privateIp === "UNKNOWN") {
			await CWLogger.Error(CW_LOG_GENERAL, {
				userId: null,
				action: "shutdown-stop-server",
				error: "Instance has no reachable private IP; skipping graceful server stop",
				details: { instanceId, state: instance.state },
			});
			return null;
		}

		return instance.privateIp;
	} catch (error) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "shutdown-stop-server",
			error: error instanceof Error ? error.message : String(error),
			details: { instanceId, stage: "resolve-private-ip" },
		});
		return null;
	}
}

/**
 * Asks TShock to save and exit. Returns false when nothing was listening — there was no server to
 * stop, so there is nothing to wait for either.
 */
async function requestServerOff(instanceId: string, ip: string): Promise<boolean> {
	try {
		const response = await new TShockAPI(ip).APIRequest(SHUTDOWN_USER_ID, "/v2/server/off", {
			confirm: true,
			message: STOP_MESSAGE,
		});

		if (isServerUnreachable(response)) {
			await CWLogger.CAction(3, CW_LOG_GENERAL, {
				userId: null,
				action: "shutdown-stop-server",
				status: "no-server-running",
				resource: instanceId,
				details: { instanceId, ip },
			});
			return false;
		}

		await CWLogger.Action(CW_LOG_GENERAL, {
			userId: null,
			action: "shutdown-stop-server",
			status: "off-requested",
			resource: instanceId,
			details: { instanceId, ip },
		});

		return true;
	} catch (error) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "shutdown-stop-server",
			error: error instanceof Error ? error.message : String(error),
			details: { instanceId, ip, stage: "server-off" },
		});
		return false;
	}
}

/**
 * True when the proxy could not connect to TShock at all.
 *
 * `TShockAPI.APIRequest` answers a connection refusal with `ResponseUtil.Success({ server: { status:
 * false } })` — an APIGatewayProxyResult returned from a method typed as returning TShock JSON. That
 * is a long-standing contract every "is the server up?" caller reads, so it is matched here rather
 * than tidied; both the wrapped and unwrapped shapes are accepted because the wrapping is incidental
 * to what it means.
 */
function isServerUnreachable(response: Record<string, any>): boolean {
	if (typeof response?.statusCode === "number" && typeof response?.body === "string") {
		try {
			return JSON.parse(response.body)?.server?.status === false;
		} catch {
			return false;
		}
	}

	return response?.server?.status === false;
}

/**
 * Blocks until the TShock process is gone, or until the budget runs out.
 *
 * `/v2/server/off` returns as soon as the request is accepted, not when the world is on disk — the
 * save happens after. Returning here without confirming the process exited would hand the file sync
 * a world file that is still being written.
 */
async function waitForTShockExit(instanceId: string, deadline: number): Promise<void> {
	const waitSeconds = Math.floor((deadline - Date.now() - SSM_ROUND_TRIP_RESERVE_MS) / 1000);
	if (waitSeconds <= 0) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "shutdown-stop-server",
			error: "No wait budget left; proceeding without confirming the server exited",
			details: { instanceId },
		});
		return;
	}

	const pattern = tshockProcessPattern();
	const commands = [
		"#!/bin/bash",
		`for i in $(seq 1 ${waitSeconds}); do`,
		`  if ! pgrep -f '${pattern}' >/dev/null 2>&1; then echo 'TSHOCK_STOPPED'; exit 0; fi`,
		"  sleep 1",
		"done",
		"echo 'TSHOCK_STILL_RUNNING'",
	];

	try {
		const SSM = new SsmDao();
		const { commandId } = await SSM.ExecuteCommand(instanceId, commands);

		const maxPolls = pollsUntilDeadline(deadline, EXIT_POLL_INTERVAL_MS);
		if (maxPolls === 0) return;

		const result = await SSM.PollForCommandCompletion(commandId, instanceId, EXIT_POLL_INTERVAL_MS, maxPolls);

		if ((result.stdout || "").includes("TSHOCK_STILL_RUNNING")) {
			// Not fatal, but the file sync behind this is about to archive a world the server may
			// still be writing, so it needs to be visible rather than inferred from a slow shutdown.
			await CWLogger.Error(CW_LOG_GENERAL, {
				userId: null,
				action: "shutdown-stop-server",
				error: "TShock did not exit within the task budget; later tasks may capture a partial world",
				details: { instanceId, waitSeconds },
			});
			return;
		}

		await CWLogger.Action(CW_LOG_GENERAL, {
			userId: null,
			action: "shutdown-stop-server",
			status: "server-exited",
			resource: instanceId,
			details: { instanceId, waitSeconds },
		});
	} catch (error) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "shutdown-stop-server",
			// A poll timeout means we stopped watching, not that the wait failed — the script is still
			// counting down on the box and the server is still on its way out.
			error: isSsmPollTimeout(error)
				? "Stopped waiting on the server-exit check before it reported back"
				: error instanceof Error ? error.message : String(error),
			details: { instanceId, waitSeconds, stage: "wait-for-exit" },
		});
	}
}
