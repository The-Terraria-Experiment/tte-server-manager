import { CWLogger } from "../shared/aws/CloudWatch.js";
import { SqsDao } from "../shared/aws/SQS.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Assert } from "../shared/utils/Assert.js";
import type { CheckResult, CheckStage } from "./types.js";
import { getAutoShutoffState, getIdleStatus, updateAutoShutoffState } from "./state.js";
import { broadcastWarning, getTShockTarget, stopServer } from "./tshock.js";

const AUTO_SHUTOFF_USER_ID = "[auto-shutoff]";
const IDLE_MINUTES = parseNumber(process.env.AUTO_SHUTOFF_IDLE_MINUTES, 60);
const EC2_DELAY_MINUTES = parseNumber(process.env.AUTO_SHUTOFF_EC2_DELAY_MINUTES, 1);

const SECOND_CHECK_DELAY_SECONDS = 5 * 60;
const FINAL_CHECK_DELAY_SECONDS = 3 * 60;
const SHUTDOWN_DELAY_SECONDS = 2 * 60;

const CANCEL_INSTRUCTIONS = " You should not be able to see this message! If you do, go to the server manager site, click 'Cancel Auto Shutoff', and then alert @havoc!"
const WARNING_10_MINUTES = "Server will shut down in 10 minutes due to inactivity." + CANCEL_INSTRUCTIONS;
const WARNING_5_MINUTES = "Server will shut down in 5 minutes due to inactivity." + CANCEL_INSTRUCTIONS;
const WARNING_2_MINUTES = "Server will shut down in 2 minutes due to inactivity." + CANCEL_INSTRUCTIONS;
const STOP_MESSAGE = "Server shutting down due to inactivity.";

export async function runCheck(serverId: string, stage: CheckStage): Promise<CheckResult> {
	const idleStatus = await getIdleStatus(serverId, IDLE_MINUTES);
	const state = await getAutoShutoffState(serverId);
	const pauseUntilAt = typeof state?.pauseUntilAt === "number" ? state.pauseUntilAt : null;

	if (pauseUntilAt && pauseUntilAt > Date.now()) {
		await updateAutoShutoffState(serverId, {
			sequenceStage: `paused-${stage}`,
			sequenceUpdatedAt: Date.now(),
			scheduledShutdownAt: null,
		});
		return {
			serverId,
			stage,
			action: "pause",
			reason: "pause-active",
			idleMinutes: idleStatus.idleMinutes,
		};
	} else if (pauseUntilAt && pauseUntilAt < Date.now()) {
		await updateAutoShutoffState(serverId, {
			pauseUntilAt: null,
		});
	}

	if (state?.canceled) {
		await updateAutoShutoffState(serverId, {
			canceled: false,
			sequenceStage: `manual-cancel-accepted`,
			sequenceUpdatedAt: Date.now(),
			scheduledShutdownAt: null,
		});
		return {
			serverId,
			stage,
			action: "cancel",
			reason: "cancel-active",
			idleMinutes: idleStatus.idleMinutes,
		};
	}

	const serverStartedAt = typeof state?.serverStartedAt === "number" ? state.serverStartedAt : null;
	if (serverStartedAt && (Date.now() - serverStartedAt) < IDLE_MINUTES * 60 * 1000) {
		await updateAutoShutoffState(serverId, {
			sequenceStage: `grace-${stage}`,
			sequenceUpdatedAt: Date.now(),
			scheduledShutdownAt: null,
		});
		return {
			serverId,
			stage,
			action: "skip",
			reason: "server-recently-started",
			idleMinutes: idleStatus.idleMinutes,
		};
	}

	CWLogger.CAction(2, FUNC_NAMES.AUTO_SHUTOFF_MGR, {
		userId: "[auto-shutoff]",
		action: "run-check",
	});

	if (!idleStatus.lastPlayerLogAt) {
		await updateAutoShutoffState(serverId, {
			sequenceStage: `cancelled-${stage}`,
			sequenceUpdatedAt: Date.now(),
			scheduledShutdownAt: null,
		});
		return {
			serverId,
			stage,
			action: "skip",
			reason: "no-player-log",
			idleMinutes: idleStatus.idleMinutes,
		};
	}

	if (!idleStatus.idle) {
		await updateAutoShutoffState(serverId, {
			sequenceStage: `cancelled-${stage}`,
			sequenceUpdatedAt: Date.now(),
			scheduledShutdownAt: null,
		});
		return {
			serverId,
			stage,
			action: "cancel",
			reason: "recent-player-log",
			idleMinutes: idleStatus.idleMinutes,
		};
	}

	const target = await getTShockTarget(serverId);
	if (!target) {
		return {
			serverId,
			stage,
			action: "skip",
			reason: "server-unreachable",
			idleMinutes: idleStatus.idleMinutes,
		};
	}

	switch (stage) {
		case "initial":
			await updateAutoShutoffState(serverId, {
				sequenceStage: stage,
				sequenceUpdatedAt: Date.now(),
				scheduledShutdownAt: Date.now() + (SECOND_CHECK_DELAY_SECONDS + FINAL_CHECK_DELAY_SECONDS + SHUTDOWN_DELAY_SECONDS) * 1000,
			});
			if (await broadcastWarning(target, WARNING_10_MINUTES)) {
				await enqueueMessage(
					{ type: "check", stage: "second", serverId },
					SECOND_CHECK_DELAY_SECONDS,
				);
				return {
					serverId,
					stage,
					action: "warn",
					reason: "queued-second-check",
					idleMinutes: idleStatus.idleMinutes,
				};
			}
			return {
				serverId,
				stage,
				action: "skip",
				reason: "broadcast-failed",
				idleMinutes: idleStatus.idleMinutes,
			};
		case "second":
			await updateAutoShutoffState(serverId, {
				sequenceStage: stage,
				sequenceUpdatedAt: Date.now(),
				scheduledShutdownAt: Date.now() + (FINAL_CHECK_DELAY_SECONDS + SHUTDOWN_DELAY_SECONDS) * 1000,
			});
			if (await broadcastWarning(target, WARNING_5_MINUTES)) {
				await enqueueMessage(
					{ type: "check", stage: "final", serverId },
					FINAL_CHECK_DELAY_SECONDS,
				);
				return {
					serverId,
					stage,
					action: "warn",
					reason: "queued-final-check",
					idleMinutes: idleStatus.idleMinutes,
				};
			}
			return {
				serverId,
				stage,
				action: "skip",
				reason: "broadcast-failed",
				idleMinutes: idleStatus.idleMinutes,
			};
		case "final":
			await updateAutoShutoffState(serverId, {
				sequenceStage: stage,
				sequenceUpdatedAt: Date.now(),
				scheduledShutdownAt: Date.now() + SHUTDOWN_DELAY_SECONDS * 1000,
			});
			if (await broadcastWarning(target, WARNING_2_MINUTES)) {
				await enqueueMessage(
					{ type: "check", stage: "shutdown", serverId },
					SHUTDOWN_DELAY_SECONDS,
				);
				return {
					serverId,
					stage,
					action: "warn",
					reason: "queued-shutdown",
					idleMinutes: idleStatus.idleMinutes,
				};
			}
			return {
				serverId,
				stage,
				action: "skip",
				reason: "broadcast-failed",
				idleMinutes: idleStatus.idleMinutes,
			};
		case "shutdown": {
			const stopped = await stopServer(target, STOP_MESSAGE);
			if (stopped) {
				await updateAutoShutoffState(serverId, {
					sequenceStage: stage,
					sequenceUpdatedAt: Date.now(),
					shutdownRequestedAt: Date.now(),
					scheduledShutdownAt: null,
				});
				await enqueueMessage(
					{ type: "ec2-stop", serverId },
					Math.max(0, EC2_DELAY_MINUTES * 60),
				);
				return {
					serverId,
					stage,
					action: "stop-server",
					reason: "queued-ec2-stop",
					idleMinutes: idleStatus.idleMinutes,
				};
			}

			await CWLogger.Error(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
				userId: AUTO_SHUTOFF_USER_ID,
				action: "stop-server",
				error: "server did not stop",
				details: {
					serverId,
					target
				}
			});
			return {
				serverId,
				stage,
				action: "skip",
				reason: "stop-failed",
				idleMinutes: idleStatus.idleMinutes,
			};
		}
		default:
			return {
				serverId,
				stage,
				action: "skip",
				reason: "unknown-stage",
				idleMinutes: idleStatus.idleMinutes,
			};
	}
}

function parseNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

async function enqueueMessage(message: object, delaySeconds: number): Promise<void> {
	let queueUrl = process.env.AUTO_SHUTOFF_QUEUE_URL || "";
	Assert.IsTruthyString(queueUrl, "AUTO_SHUTOFF_QUEUE_URL is not set");
	if (process.env.ACTIVE_ENV === "stage") {
		queueUrl += "-stage";
	}
	const sqs = new SqsDao();
	await sqs.SendMessage(queueUrl, message, delaySeconds);
}
