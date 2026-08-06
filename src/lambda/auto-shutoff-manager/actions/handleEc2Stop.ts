import type { Context } from "aws-lambda";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import type { AutoShutoffMessage, CheckResult } from "./types.js";
import { getAutoShutoffState, getIdleStatus, updateAutoShutoffState } from "./state.js";
import { isShutdownBlocking, queueShutdownJob, readShutdownJob } from "../shared/utils/ShutdownJob.js";
import { INSTANCE_MANAGER_FUNCTION_ARN } from "../shared/vars.js";

const AUTO_SHUTOFF_USER_ID = "[auto-shutoff]";
const IDLE_MINUTES = parseNumber(process.env.AUTO_SHUTOFF_IDLE_MINUTES, 60);

export async function handleEc2Stop(message: AutoShutoffMessage, context: Context): Promise<CheckResult> {
	const serverId = message.serverId;
	if (!serverId) {
		return { action: "skip", reason: "missing-server-id" };
	}

	const state = await getAutoShutoffState(serverId);
	const serverStartedAt = typeof state?.serverStartedAt === "number" ? state.serverStartedAt : null;
	const instanceStartedAt = typeof state?.instanceStartedAt === "number" ? state.instanceStartedAt : null;
	const mostRecentStartAt = Math.max(serverStartedAt ?? 0, instanceStartedAt ?? 0) || null;
	if (mostRecentStartAt && (Date.now() - mostRecentStartAt) < IDLE_MINUTES * 60 * 1000) {
		await updateAutoShutoffState(serverId, {
			sequenceStage: "cancelled-ec2-grace",
			sequenceUpdatedAt: Date.now(),
		});
		return {
			serverId,
			action: "cancel",
			reason: "recently-started",
			idleMinutes: null,
		};
	}

	const idleStatus = await getIdleStatus(serverId, IDLE_MINUTES);
	if (!idleStatus.idle) {
		await updateAutoShutoffState(serverId, {
			sequenceStage: "cancelled-ec2",
			sequenceUpdatedAt: Date.now(),
		});
		return {
			serverId,
			action: "cancel",
			reason: "recent-player-log",
			idleMinutes: idleStatus.idleMinutes,
		};
	}

	// Someone may have pressed STOP during the countdown. Queueing over a live job would overwrite the
	// row a worker is already heartbeating, and since the claim is per-jobID that worker would keep
	// running — two task lists and two stop calls against the same box.
	if (isShutdownBlocking(await readShutdownJob(serverId))) {
		return { serverId, action: "skip", reason: "shutdown-already-running", idleMinutes: idleStatus.idleMinutes };
	}

	void context;

	try {
		// Hands the whole shutdown sequence — archive, sync, stop — to instance-manager's worker
		// rather than running it here. It used to run inline on this lambda's 15s timeout, the
		// tightest budget of any caller, which meant the unattended path was the one most likely to
		// abandon a world sync half-done. Going through the worker also means there is exactly one
		// definition of what a shutdown does, and that an auto-shutdown reports its stage to the UI
		// the same way a hand-pressed one does.
		const jobID = await queueShutdownJob(serverId, AUTO_SHUTOFF_USER_ID, INSTANCE_MANAGER_FUNCTION_ARN);

		await updateAutoShutoffState(serverId, {
			ec2StopRequestedAt: Date.now(),
			sequenceStage: "ec2-stop",
			sequenceUpdatedAt: Date.now(),
		});
		await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "stop-instance",
			status: "queued",
			resource: serverId,
			details: { jobID },
		});
		return { serverId, action: "stop-instance", idleMinutes: idleStatus.idleMinutes };
	} catch (error) {
		await CWLogger.Error(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "stop-instance",
			error: error instanceof Error ? error.message : String(error),
			details: { serverId },
		});
		return { serverId, action: "skip", reason: "ec2-stop-failed" };
	}
}

function parseNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}
