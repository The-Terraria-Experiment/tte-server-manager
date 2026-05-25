import type { Context } from "aws-lambda";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { DynamoDao } from "./shared/aws/DynamoDB.js";
import { Ec2Dao, InstanceState } from "./shared/aws/EC2.js";
import { LOGS_TABLE, SYSTEM_TABLE } from "./shared/vars.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { TShockAPI } from "./shared/utils/TShockAPI.js";
import type { LogDataEntry } from "./shared/schema/LogsTable.js";
import type { AutoShutoffStateEntry } from "./shared/schema/SystemTable.js";

const AUTO_SHUTOFF_SERVER_IDS = process.env.AUTO_SHUTOFF_SERVER_IDS || "";
const IDLE_SHUTOFF_MINUTES = parseNumber(process.env.IDLE_SHUTOFF_MINUTES, 60);
const EC2_SHUTOFF_GRACE_MINUTES = parseNumber(process.env.EC2_SHUTOFF_GRACE_MINUTES, 30);
const AUTO_SHUTOFF_USER_ID = "[auto-shutoff]";

const STAGES = {
	ACTIVE: "active",
	IDLE: "idle",
	SERVER_STOPPED: "server-stopped",
	INSTANCE_STOPPED: "instance-stopped",
	UNKNOWN: "unknown",
} as const;

type AutoShutoffEvent = {
	source?: string;
	"detail-type"?: string;
	detailType?: string;
	detail?: {
		serverId?: string;
		serverID?: string;
		playersActive?: number;
		eventType?: string;
		occurredAtUtc?: string;
	};
	serverId?: string;
	serverID?: string;
};

type DecisionResult = {
	serverId: string;
	action: string;
	reason?: string;
	idleMinutes?: number | null;
	livePlayers?: number | null;
	instanceState?: string;
};

export const handler = async (event: AutoShutoffEvent, context: Context) => {
	void context;

	const serverIds = resolveServerIds(event);
	if (serverIds.length === 0) {
		await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "skip",
			status: "no-servers",
			resource: null,
			details: { source: event?.source || "unknown" },
		});
		await CWLogger.FlushAll();
		return { ok: true, skipped: "no-servers" };
	}

	const results: DecisionResult[] = [];
	for (const serverId of serverIds) {
		results.push(await evaluateServer(serverId, event));
	}

	await CWLogger.FlushAll();

	return { ok: true, results };
};

function resolveServerIds(event: AutoShutoffEvent): string[] {
	const eventServerId =
		event?.detail?.serverId ||
		event?.detail?.serverID ||
		event?.serverId ||
		event?.serverID;

	if (typeof eventServerId === "string" && eventServerId.trim().length > 0) {
		return [eventServerId.trim()];
	}

	return AUTO_SHUTOFF_SERVER_IDS.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

async function evaluateServer(serverId: string, event: AutoShutoffEvent): Promise<DecisionResult> {
	const now = Date.now();
	const db = new DynamoDao();
	const stateKey = buildStateKey(serverId);
	const existingState = (await db.GetItem(SYSTEM_TABLE, stateKey)) as AutoShutoffStateEntry | null;
	const ec2 = new Ec2Dao();

	await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
		userId: AUTO_SHUTOFF_USER_ID,
		action: "check",
		resource: serverId,
		details: {
			source: event?.source || "unknown",
			detailType: event?.detailType || event?.["detail-type"] || "unknown",
		},
	});

	let instanceStatus;
	try {
		instanceStatus = await ec2.GetInstanceStatus(serverId);
	} catch (error) {
		await CWLogger.Error(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "instance-status",
			error: error instanceof Error ? error.message : String(error),
			details: { serverId },
		});
		return { serverId, action: "skip", reason: "instance-not-found" };
	}

	if (instanceStatus.state !== InstanceState.RUNNING) {
		await persistState(
			db,
			mergeState(existingState, {
				uid: stateKey,
				serverId,
				stage: STAGES.INSTANCE_STOPPED,
				lastCheckAt: now,
				instanceState: instanceStatus.state,
				instanceStopAt: existingState?.instanceStopAt || now,
			}),
		);

		return {
			serverId,
			action: "skip",
			reason: "instance-not-running",
			instanceState: instanceStatus.state,
		};
	}

	const ip = instanceStatus.publicIp;
	if (!ip || ip === "PENDING") {
		await persistState(
			db,
			mergeState(existingState, {
				uid: stateKey,
				serverId,
				stage: existingState?.stage || STAGES.UNKNOWN,
				lastCheckAt: now,
				instanceState: instanceStatus.state,
			}),
		);

		return {
			serverId,
			action: "skip",
			reason: "instance-ip-unavailable",
			instanceState: instanceStatus.state,
		};
	}

	const latestLog = await getLatestLog(serverId);
	const lastLogAt = typeof latestLog?.timestamp === "number" ? latestLog.timestamp : null;
	const lastLogPlayers =
		typeof latestLog?.playersActive === "number" ? latestLog.playersActive : null;

	let lastNonEmptyAt = existingState?.lastNonEmptyAt ?? null;
	let lastEmptyAt = existingState?.lastEmptyAt ?? null;
	let stage = existingState?.stage || STAGES.UNKNOWN;
	let serverStopAt = existingState?.serverStopAt ?? null;
	let instanceStopAt = existingState?.instanceStopAt ?? null;

	if (lastLogPlayers !== null && lastLogAt !== null) {
		if (lastLogPlayers > 0) {
			lastNonEmptyAt = lastLogAt;
			lastEmptyAt = null;
		} else if (lastLogPlayers === 0) {
			if (!lastEmptyAt || lastLogAt > lastEmptyAt) {
				lastEmptyAt = lastLogAt;
			}
		}
	}

	const tshock = new TShockAPI(ip);
	const livePlayers = await getLivePlayerCount(tshock);

	if (livePlayers !== null && livePlayers > 0) {
		stage = STAGES.ACTIVE;
		lastNonEmptyAt = now;
		lastEmptyAt = null;
		serverStopAt = null;
		instanceStopAt = null;

		await persistState(
			db,
			mergeState(existingState, {
				uid: stateKey,
				serverId,
				stage,
				lastCheckAt: now,
				lastLogAt,
				lastLogPlayers,
				lastNonEmptyAt,
				lastEmptyAt,
				livePlayers,
				serverStopAt,
				instanceStopAt,
				instanceState: instanceStatus.state,
			}),
		);

		return {
			serverId,
			action: "none",
			reason: "players-active",
			idleMinutes: 0,
			livePlayers,
			instanceState: instanceStatus.state,
		};
	}

	if (stage === STAGES.SERVER_STOPPED && serverStopAt) {
		const ec2GraceMinutes = (now - serverStopAt) / (60 * 1000);
		if (ec2GraceMinutes >= EC2_SHUTOFF_GRACE_MINUTES) {
			const stopped = await stopInstance(serverId);
			if (stopped) {
				stage = STAGES.INSTANCE_STOPPED;
				instanceStopAt = now;
			}
			await persistState(
				db,
				mergeState(existingState, {
					uid: stateKey,
					serverId,
					stage,
					lastCheckAt: now,
					lastLogAt,
					lastLogPlayers,
					lastNonEmptyAt,
					lastEmptyAt,
					livePlayers,
					serverStopAt,
					instanceStopAt,
					instanceState: instanceStatus.state,
				}),
			);

			return {
				serverId,
				action: stopped ? "stop-instance" : "skip",
				reason: stopped ? "ec2-grace-elapsed" : "ec2-stop-failed",
				idleMinutes: null,
				livePlayers,
				instanceState: instanceStatus.state,
			};
		}
	}

	const idleStart = lastEmptyAt ?? lastLogAt ?? null;
	let idleMinutes = idleStart ? (now - idleStart) / (60 * 1000) : null;

	if (livePlayers === 0) {
		if (!lastEmptyAt) {
			lastEmptyAt = idleStart || now;
			idleMinutes = (now - lastEmptyAt) / (60 * 1000);
		}

		if (idleMinutes !== null && idleMinutes >= IDLE_SHUTOFF_MINUTES) {
			if (stage !== STAGES.SERVER_STOPPED) {
				const stopped = await stopTShockServer(tshock, serverId, ip);
				if (stopped) {
					stage = STAGES.SERVER_STOPPED;
					serverStopAt = now;
				}
				await persistState(
					db,
					mergeState(existingState, {
						uid: stateKey,
						serverId,
						stage,
						lastCheckAt: now,
						lastLogAt,
						lastLogPlayers,
						lastNonEmptyAt,
						lastEmptyAt,
						livePlayers,
						serverStopAt,
						instanceState: instanceStatus.state,
					}),
				);

				return {
					serverId,
					action: stopped ? "stop-server" : "skip",
					reason: stopped ? "idle-threshold" : "stop-failed",
					idleMinutes,
					livePlayers,
					instanceState: instanceStatus.state,
				};
			}

		}

		stage = stage === STAGES.SERVER_STOPPED ? stage : STAGES.IDLE;
	}

	await persistState(
		db,
		mergeState(existingState, {
			uid: stateKey,
			serverId,
			stage,
			lastCheckAt: now,
			lastLogAt,
			lastLogPlayers,
			lastNonEmptyAt,
			lastEmptyAt,
			livePlayers,
			serverStopAt,
			instanceStopAt,
			instanceState: instanceStatus.state,
		}),
	);

	return {
		serverId,
		action: "none",
		reason: livePlayers === null ? "live-check-unknown" : "idle-threshold-not-met",
		idleMinutes,
		livePlayers,
		instanceState: instanceStatus.state,
	};
}

async function getLatestLog(serverId: string): Promise<LogDataEntry | null> {
	const db = new DynamoDao();
	const serverKey = `server#${serverId}`;
	const result = await db.Query(LOGS_TABLE, {
		keyCondition: "#pk = :pk",
		limit: 1,
		scanIndexForward: false,
		expressionAttributeNames: { "#pk": "serverID" },
		expressionAttributeValues: { ":pk": serverKey },
	});

	return (result.items?.[0] as LogDataEntry) || null;
}

async function persistState(db: DynamoDao, state: AutoShutoffStateEntry): Promise<void> {
	await db.PutItem(SYSTEM_TABLE, state as Record<string, unknown>);
}

async function getLivePlayerCount(tshock: TShockAPI): Promise<number | null> {
	const status = await callTShock(tshock, "/v2/server/status", { players: true, rules: false });
	const statusCount = extractPlayerCount(status);
	if (statusCount !== null) {
		return statusCount;
	}

	const list = await callTShock(tshock, "/v2/players/list");
	return extractPlayerCount(list);
}

function extractPlayerCount(payload: Record<string, any> | null): number | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}

	const directCount =
		typeof payload.playercount === "number"
			? payload.playercount
			: typeof payload.playerCount === "number"
				? payload.playerCount
				: null;
	if (directCount !== null) {
		return directCount;
	}

	const candidates = [
		payload.players,
		payload.Players,
		payload.playerlist,
		payload.playerList,
		payload.response?.players,
		payload.response?.Players,
		payload.response?.playerlist,
		payload.response?.playerList,
	];

	for (const candidate of candidates) {
		if (Array.isArray(candidate)) {
			return candidate.length;
		}
	}

	return null;
}

async function callTShock(
	tshock: TShockAPI,
	endpoint: string,
	params: Record<string, any> | undefined = undefined,
): Promise<Record<string, any> | null> {
	try {
		const response = await tshock.APIRequest(AUTO_SHUTOFF_USER_ID, endpoint, params);
		const normalized = normalizeTShockPayload(response);
		if (normalized?.server?.status === false) {
			return null;
		}
		return normalized;
	} catch (error) {
		await CWLogger.Error(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "tshock-call",
			error: error instanceof Error ? error.message : String(error),
			details: { endpoint },
		});
		return null;
	}
}

function normalizeTShockPayload(payload: Record<string, any> | null): Record<string, any> | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}

	if (typeof (payload as any).statusCode === "number" && typeof (payload as any).body === "string") {
		try {
			return JSON.parse((payload as any).body);
		} catch {
			return null;
		}
	}

	return payload;
}

async function stopTShockServer(tshock: TShockAPI, serverId: string, ip: string): Promise<boolean> {
	const response = await callTShock(tshock, "/v2/server/off", { confirm: true, message: "Auto shutoff" });
	if (!response) {
		return false;
	}

	await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
		userId: AUTO_SHUTOFF_USER_ID,
		action: "stop-server",
		resource: serverId,
		details: { ip },
	});

	return true;
}

async function stopInstance(serverId: string): Promise<boolean> {
	try {
		const ec2 = new Ec2Dao();
		await ec2.StopInstance(serverId);
		await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "stop-instance",
			resource: serverId,
		});
		return true;
	} catch (error) {
		await CWLogger.Error(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "stop-instance",
			error: error instanceof Error ? error.message : String(error),
			details: { serverId },
		});
		return false;
	}
}

function parseNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function buildStateKey(serverId: string): string {
	return `autoshutoff#${serverId}`;
}

function mergeState(
	current: AutoShutoffStateEntry | null,
	updates: AutoShutoffStateEntry,
): AutoShutoffStateEntry {
	return {
		...(current || {}),
		...updates,
		uid: updates.uid || current?.uid,
		serverId: updates.serverId || current?.serverId,
	};
}
