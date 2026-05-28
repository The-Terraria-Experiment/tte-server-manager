import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { FUNC_NAMES } from "../shared/constants.js";
import type { AutoShutoffMessage, CheckResult } from "./types.js";
import { getIdleStatus, updateAutoShutoffState } from "./state.js";

const AUTO_SHUTOFF_USER_ID = "[auto-shutoff]";
const IDLE_MINUTES = parseNumber(process.env.AUTO_SHUTOFF_IDLE_MINUTES, 60);

export async function handleEc2Stop(message: AutoShutoffMessage): Promise<CheckResult> {
	const serverId = message.serverId;
	if (!serverId) {
		return { action: "skip", reason: "missing-server-id" };
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

	try {
		const ec2 = new Ec2Dao();
		await ec2.StopInstance(serverId);
		await updateAutoShutoffState(serverId, {
			ec2StopRequestedAt: Date.now(),
			sequenceStage: "ec2-stop",
			sequenceUpdatedAt: Date.now(),
		});
		await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "stop-instance",
			resource: serverId,
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
