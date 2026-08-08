import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import { InstanceRegistry } from "../shared/utils/instance/InstanceRegistry.js";
import type { AutoShutoffStateEntry } from "../shared/schema/SystemTable.js";

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

export async function updateAutoShutoffState(
	serverId: string,
	updates: Partial<AutoShutoffStateEntry>,
): Promise<void> {
	const db = new DynamoDao();
	const stateKey = buildStateKey(serverId);
	await db.UpdateItem(SYSTEM_TABLE, stateKey, {
		updates: {
			serverId,
			lastUpdatedAt: Date.now(),
			...updates,
		},
	});
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
