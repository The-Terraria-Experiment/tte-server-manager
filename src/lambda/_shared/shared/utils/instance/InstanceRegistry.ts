import { DynamoDao } from "../../aws/DynamoDB.js";
import { Assert } from "../core/Assert.js";
import { CURRENT_ENV, ENVIRONMENTS, type EnvironmentName } from "../../vars.js";
import type { InstanceDataEntry } from "../../schema/InstanceTable.js";

export const INSTANCE_KEY_PREFIX = "inst#";

export interface InstanceRegistryEntry {
	id: string;
	envs: EnvironmentName[];
	name?: string;
	registeredAt?: string;
	registeredBy?: string;
}

/**
 * The list of EC2 instances the app knows about, sourced from the `inst#<id>` rows of the instance
 * table. This replaces the `EC2_INSTANCE_IDS` and `AUTO_SHUTOFF_SERVER_IDS_*` env vars, which had to
 * be hand-edited on several functions and then republished before any alias picked up a new box.
 *
 * The row's `envs` attribute is the registration: an instance is visible to an environment only if
 * that environment is listed. A row with no `envs` is not registered anywhere — setup.sh seeds
 * validRoots/metricsConfig on a fresh box before an admin has chosen its environments.
 *
 * Caching follows {@link Permissions} exactly: the entries are held in a module-level cache for the
 * life of the container, and a `cache#instances` row carrying a version string is polled at most
 * once per INSTANCE_CACHE_VERSION_POLL_MS. A version change drops the cache; otherwise the scan
 * never re-runs. So a hot container costs at most one small GetItem per poll window and usually
 * nothing, which matters because this is now on the path of every instance-scoped request.
 *
 * The version row deliberately lives in the *instance* table, not the system table. The system table
 * is per-environment, so a bump written by stage would be invisible to prod — while the thing being
 * invalidated (the instance table) is shared by both.
 */
export class InstanceRegistry {
	private static readonly dynamoDao = new DynamoDao();
	private static readonly CACHE_VERSION_UID = "cache#instances";
	private static readonly CACHE_VERSION_POLL_MS = Number(process.env.INSTANCE_CACHE_VERSION_POLL_MS || 60 * 1000);

	private static entryCache: InstanceRegistryEntry[] | null = null;
	private static lastSeenCacheVersion: string | null = null;
	private static lastVersionCheckAt = 0;

	private static TableName(): string {
		const tableName = process.env.INSTANCE_TABLE_NAME;
		Assert.IsTruthyString(tableName, "INSTANCE_TABLE_NAME environment variable is required");
		return tableName as string;
	}

	/**
	 * Re-reads the cache version at most once per poll window, dropping the entry cache when it has
	 * moved. Cross-container invalidation is therefore eventual, bounded by the poll interval — which
	 * is the right trade for a list that changes a handful of times a year.
	 */
	private static async RefreshCacheVersionIfNeeded(): Promise<void> {
		const now = Date.now();
		if (
			InstanceRegistry.lastSeenCacheVersion !== null &&
			now - InstanceRegistry.lastVersionCheckAt < InstanceRegistry.CACHE_VERSION_POLL_MS
		) {
			return;
		}

		InstanceRegistry.lastVersionCheckAt = now;
		const cacheVersionItem = await InstanceRegistry.dynamoDao.GetItem(
			InstanceRegistry.TableName(),
			InstanceRegistry.CACHE_VERSION_UID,
		);
		const currentVersion = String(cacheVersionItem?.version || "0");

		if (InstanceRegistry.lastSeenCacheVersion === null) {
			InstanceRegistry.lastSeenCacheVersion = currentVersion;
			return;
		}

		if (InstanceRegistry.lastSeenCacheVersion !== currentVersion) {
			InstanceRegistry.DropCache();
			InstanceRegistry.lastSeenCacheVersion = currentVersion;
		}
	}

	/**
	 * Invalidate every container's cached registry. Must be called by anything that writes an
	 * `inst#<id>` row's `envs`.
	 * @returns The new cache version identifier
	 */
	public static async BumpCacheVersion(): Promise<string> {
		const newVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const updatedAt = new Date().toISOString();

		const updated = await InstanceRegistry.dynamoDao.UpdateItem(
			InstanceRegistry.TableName(),
			InstanceRegistry.CACHE_VERSION_UID,
			{ updates: { version: newVersion, updatedAt } },
		);

		if (!updated) {
			throw new Error("Failed to bump instance registry cache version");
		}

		InstanceRegistry.DropCache();
		InstanceRegistry.lastSeenCacheVersion = newVersion;
		InstanceRegistry.lastVersionCheckAt = Date.now();

		return newVersion;
	}

	/**
	 * Every `inst#<id>` row in the table, registered or not, ignoring environment.
	 * For the registry editor — use {@link GetRegisteredInstances} for anything user-facing.
	 *
	 * @param options.skipCache - Scan now instead of trusting the cache. The editor needs this:
	 *   after a save it immediately refetches, and that request can land on a *different* warm
	 *   container whose version poll isn't due for up to a minute — which would show the admin a list
	 *   without the change they just made. Reads here are admin-only and rare, so paying for a scan
	 *   is the right trade; the cached path is what keeps `list` and auto-shutoff cheap.
	 */
	public static async GetAllEntries(options: { skipCache?: boolean } = {}): Promise<InstanceRegistryEntry[]> {
		if (options.skipCache) {
			InstanceRegistry.DropCache();
		} else {
			await InstanceRegistry.RefreshCacheVersionIfNeeded();

			if (InstanceRegistry.entryCache !== null) {
				return InstanceRegistry.entryCache;
			}
		}

		const rows = (await InstanceRegistry.dynamoDao.ScanTable(InstanceRegistry.TableName(), {
			prefix: INSTANCE_KEY_PREFIX,
		})) as InstanceDataEntry[];

		const entries = rows
			.map((row) => InstanceRegistry.ToEntry(row))
			.filter((entry): entry is InstanceRegistryEntry => entry !== null)
			.sort((a, b) => a.id.localeCompare(b.id));

		InstanceRegistry.entryCache = entries;
		return entries;
	}

	/**
	 * The instances registered to an environment.
	 * @param env - Environment to filter by. Defaults to the one this lambda is running as.
	 */
	public static async GetRegisteredInstances(env: EnvironmentName = CURRENT_ENV): Promise<InstanceRegistryEntry[]> {
		const entries = await InstanceRegistry.GetAllEntries();
		return entries.filter((entry) => entry.envs.includes(env));
	}

	/**
	 * The instance IDs registered to an environment. The direct replacement for reading and splitting
	 * `EC2_INSTANCE_IDS` / `AUTO_SHUTOFF_SERVER_IDS_*`.
	 * @param env - Environment to filter by. Defaults to the one this lambda is running as.
	 */
	public static async GetRegisteredInstanceIds(env: EnvironmentName = CURRENT_ENV): Promise<string[]> {
		return (await InstanceRegistry.GetRegisteredInstances(env)).map((entry) => entry.id);
	}

	/**
	 * Whether an instance is registered to an environment.
	 * @param instanceId - EC2 instance ID
	 * @param env - Environment to check. Defaults to the one this lambda is running as.
	 */
	public static async IsRegistered(instanceId: string, env: EnvironmentName = CURRENT_ENV): Promise<boolean> {
		if (!instanceId) {
			return false;
		}
		return (await InstanceRegistry.GetRegisteredInstances(env)).some((entry) => entry.id === instanceId);
	}

	/** Clear this container's cached registry. */
	public static DropCache(): void {
		InstanceRegistry.entryCache = null;
	}

	/**
	 * Narrows a raw row to a registry entry, dropping anything unusable. Unrecognised environment
	 * names are discarded rather than trusted — `envs` is hand-editable in Dynamo, and a typo like
	 * "prd" silently listing an instance nowhere is far easier to diagnose than one that leaks it
	 * into a filter it was never meant to match.
	 */
	private static ToEntry(row: InstanceDataEntry): InstanceRegistryEntry | null {
		const uid = typeof row?.uid === "string" ? row.uid : "";
		if (!uid.startsWith(INSTANCE_KEY_PREFIX)) {
			return null;
		}

		const id = uid.slice(INSTANCE_KEY_PREFIX.length);
		if (!id) {
			return null;
		}

		const rawEnvs = Array.isArray(row.envs) ? row.envs : [];
		const envs = ENVIRONMENTS.filter((env) => rawEnvs.includes(env));

		return {
			id,
			envs,
			...(row.name ? { name: row.name } : {}),
			...(row.registeredAt ? { registeredAt: row.registeredAt } : {}),
			...(row.registeredBy ? { registeredBy: row.registeredBy } : {}),
		};
	}
}
