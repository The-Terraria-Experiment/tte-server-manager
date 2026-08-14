import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import { InstanceRegistry } from "../shared/utils/instance/InstanceRegistry.js";
import type { AutoShutoffStateEntry } from "../shared/schema/SystemTable.js";
import { Realtime } from "../shared/utils/realtime/RealtimePublisher.js";

const STATE_PREFIX = "autoshutoff#";

export function buildStateKey(serverId: string): string {
	return `${STATE_PREFIX}${serverId}`;
}

/**
 * The servers this environment auto-shuts-off, read from the instance registry.
 *
 * Replaces the `AUTO_SHUTOFF_SERVER_IDS_PROD`/`_STAGE` env vars, which were a second hand-maintained
 * copy of the instance list and could silently drift from `EC2_INSTANCE_IDS`. The registry's per-row
 * `envs` carries the same prod/stage split those two vars encoded, so the set of servers checked is
 * unchanged — it just has one source now.
 */
export async function getConfiguredServerIds(): Promise<string[]> {
	return InstanceRegistry.GetRegisteredInstanceIds();
}

export async function getAutoShutoffState(serverId: string): Promise<AutoShutoffStateEntry | null> {
	const db = new DynamoDao();
	const stateKey = buildStateKey(serverId);
	return (await db.GetItem(SYSTEM_TABLE, stateKey)) as AutoShutoffStateEntry | null;
}

/**
 * Fields a user actually sees in the auto-shutoff tile. Only a change to one of these is worth
 * notifying browsers about — see `updateAutoShutoffState`.
 */
const USER_VISIBLE_FIELDS: (keyof AutoShutoffStateEntry)[] = [
	"sequenceStage",
	"scheduledShutdownAt",
	"pauseUntilAt",
	"canceled",
];

export async function updateAutoShutoffState(
	serverId: string,
	updates: Partial<AutoShutoffStateEntry>,
): Promise<void> {
	const db = new DynamoDao();
	const stateKey = buildStateKey(serverId);
	// ALL_OLD so we can tell a real transition from tick churn. The return value used to be discarded,
	// so asking for the old image costs nothing extra.
	const previous = (await db.UpdateItem(SYSTEM_TABLE, stateKey, {
		updates: {
			serverId,
			lastUpdatedAt: Date.now(),
			...updates,
		},
		ReturnValues: "ALL_OLD",
	})) as AutoShutoffStateEntry | null;

	// This function is called on *every* check tick, with `grace-*`/`cancelled-*` stage churn even when
	// nothing user-visible moved. Publishing unconditionally would hand every open browser a steady
	// stream of refetch triggers, and each of those refetches reaches the game server through
	// tshock-proxy — a permanent background load proportional to the number of open tabs, attributable
	// to nothing. So only a genuine change to a field someone can see gets published.
	const changed = USER_VISIBLE_FIELDS.some(
		(field) => field in updates && previous?.[field] !== updates[field],
	);

	if (changed) {
		await Realtime.PublishAutoShutoff(serverId, updates.sequenceStage ?? undefined);
	}
}

export type IdleStatus = {
	idle: boolean;
	idleMinutes: number | null;
	lastPlayerLogAt: number | null;
	lastPlayersActive: number | null;
};

export async function getIdleStatus(serverId: string, idleMinutesRequired: number): Promise<IdleStatus> {
	const state = await getAutoShutoffState(serverId);
	const lastPlayerLogAt = typeof state?.lastPlayerLogAt === "number" ? state.lastPlayerLogAt : null;
	const lastPlayersActive =
		typeof state?.lastPlayersActive === "number" ? state.lastPlayersActive : null;

	if (!lastPlayerLogAt) {
		return {
			idle: false,
			idleMinutes: null,
			lastPlayerLogAt: null,
			lastPlayersActive,
		};
	}

	const minutesSinceLog = (Date.now() - lastPlayerLogAt) / (60 * 1000);
	return {
		idle: minutesSinceLog >= idleMinutesRequired,
		idleMinutes: minutesSinceLog,
		lastPlayerLogAt,
		lastPlayersActive,
	};
}
