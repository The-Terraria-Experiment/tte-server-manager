import { TShockAPI } from "./TShockAPI.js";
import { isRefusedConnectionEnvelope, normalizeReport, pick, type InventoryReport } from "./InventoryReport.js";
import type { ItemRulesEntry, ViolationItem } from "../../schema/SystemTable.js";

/**
 * Draining the InventoryMonitor plugin's join/leave snapshot cache, and evaluating a report against
 * an instance's item rules.
 *
 * The plugin's `/inventory/snapshots` endpoint is a **non-destructive cursor**: `since` is an
 * exclusive id floor, there is no ack and no delete, and the store is in memory with a bounded
 * retention (60 minutes by default). Everything below follows from that — the only record of what we
 * have consumed is the cursor *we* persist, and if we fall behind the retention window the plugin
 * quietly drops entries we never saw.
 *
 * Three rules that are not obvious from the endpoint's signature, all from its README:
 *
 * 1. **Never send `latest=true`.** `cursor` is `max(id)` of the returned page, so a newest-first page
 *    advances our cursor past ids we were never handed. Those snapshots are then unreachable.
 * 2. **Never filter server-side** with `player=` or `kind=`. `head` is global, so `more` stops being
 *    a reliable "drain again" signal once a filter is applied. Drain unfiltered; filter here.
 * 3. **Ids restart at 0 when the game server restarts.** A `head` below our cursor is that, not an
 *    error, and the cursor has to reset or it will sit above every id the plugin issues from then on.
 */

/** Page size. Comfortably under the plugin's own default limit; a join burst rarely exceeds a page. */
export const SNAPSHOT_PAGE_LIMIT = 200;

/** Hard stop on pages per drain, so a runaway cursor can't loop against the game server. */
const MAX_PAGES = 25;

/** Every container group the plugin knows, and the default when an instance has picked none. */
export const SNAPSHOT_GROUPS = ["core", "storage", "misc", "loadouts"] as const;

export type SnapshotKind = "join" | "leave";

export type InventorySnapshot = {
	id: number,
	kind: SnapshotKind,
	capturedAt: number,
	player: InventoryReport,
	/**
	 * TShock account name, when the player was logged in. Read off the raw report rather than through
	 * `normalizeReport`, which deliberately carries only what the inventory UI renders.
	 */
	account: string | null,
	/** `Main.ServerSideCharacter` was false at capture, so this is last-known state, not an audit record. */
	stale: boolean,
};

export type DrainResult = {
	snapshots: InventorySnapshot[],
	/** Feed back as `since` on the next drain. */
	cursor: number,
	/** Highest id the plugin has issued overall. */
	head: number,
	/** The plugin evicted entries older than our last scan — we may have missed snapshots. */
	gap: boolean,
	/** The plugin restarted and re-zeroed its ids; the cursor was reset and the drain restarted from 0. */
	rewound: boolean,
	/** Stopped on the page or time budget with `more` still true. The next drain picks up where this left off. */
	truncated: boolean,
	pages: number,
};

/** Thrown when the game server refused the connection, so the caller can report "unreachable" rather than "failed". */
export class ServerUnreachableError extends Error {
	public constructor() {
		super("The Terraria server is not responding");
		this.name = "ServerUnreachableError";
	}
}

const toEpochMs = (value: unknown): number => {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		// The plugin serializes DateTime as ISO-8601 UTC. Date.parse handles it; an unparseable value
		// becomes "now" rather than NaN, since the timestamp is only ever displayed.
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return Date.now();
};

const normalizeSnapshot = (raw: Record<string, any>): InventorySnapshot => {
	const rawPlayer = pick<Record<string, any>>(raw, "player", {});
	const kind = String(pick(raw, "kind", "join")).toLowerCase();

	return {
		id: Number(pick(raw, "id", 0)),
		kind: kind === "leave" ? "leave" : "join",
		capturedAt: toEpochMs(pick<unknown>(raw, "capturedAtUtc", null)),
		player: normalizeReport(rawPlayer),
		account: pick<string | null>(rawPlayer, "account", null),
		stale: Boolean(pick(raw, "stale", false)),
	};
};

/** Normalizes a rule set's `groups` into the plugin's `include` parameter. */
export const includeParam = (groups: string[] | undefined): string => {
	const valid = (groups ?? []).filter(group => (SNAPSHOT_GROUPS as readonly string[]).includes(group));
	return (valid.length ? valid : SNAPSHOT_GROUPS).join(",");
};

export type DrainOptions = {
	since: number,
	/** Undefined is meaningful: `includeParam` falls back to every group. */
	groups?: string[] | undefined,
	/** Wall-clock ceiling for the whole drain. The worker is async, so this is ours to pick, not API Gateway's. */
	budgetMs?: number,
	pageLimit?: number,
	/** Last successful scan, epoch ms. Used only to detect that the plugin evicted entries we hadn't read. */
	lastScanAt?: number | null,
};

/**
 * Pulls every snapshot after `since`, following the plugin's cursor until it says there is no more.
 *
 * Returns snapshots of *both* kinds. Evaluation is the caller's decision: today only joins are
 * checked against the rules, but leave captures still have to be drained past — the cursor is a
 * single global id floor, so skipping them would mean skipping the joins interleaved with them.
 */
export async function drainSnapshots(
	instanceIp: string,
	userID: string,
	options: DrainOptions,
): Promise<DrainResult> {
	const { since, groups, budgetMs = 20000, pageLimit = SNAPSHOT_PAGE_LIMIT, lastScanAt = null } = options;

	const TShock = new TShockAPI(instanceIp);
	const include = includeParam(groups);
	const deadline = Date.now() + budgetMs;

	const snapshots: InventorySnapshot[] = [];
	let cursor = Math.max(0, since);
	let head = cursor;
	let gap = false;
	let rewound = false;
	let truncated = false;
	let pages = 0;

	while (pages < MAX_PAGES) {
		const result = await TShock.APIRequest(userID, "/inventory/snapshots", {
			since: cursor,
			limit: pageLimit,
			include,
		});

		if (isRefusedConnectionEnvelope(result)) {
			throw new ServerUnreachableError();
		}

		pages++;

		head = Number(pick(result, "head", head));

		// A head below our cursor means the plugin's process-unique ids restarted — the server came
		// back up with an empty store. Reset and take the drain from the top rather than waiting for
		// ids that will never be issued again. Guarded by `rewound` so a plugin reporting something
		// strange can't put us in a loop.
		if (head < cursor && !rewound) {
			rewound = true;
			cursor = 0;
			snapshots.length = 0;
			continue;
		}

		// The store evicts by age. If the oldest thing it still holds is newer than our last successful
		// scan, entries expired in between and we are not seeing everything. Not recoverable, but very
		// much worth saying out loud in the logs.
		const oldestRetained = pick<unknown>(result, "oldestRetainedUtc", null);
		if (lastScanAt && oldestRetained) {
			gap = gap || toEpochMs(oldestRetained) > lastScanAt;
		}

		const page = pick<Record<string, any>[]>(result, "snapshots", []);
		for (const raw of page) {
			snapshots.push(normalizeSnapshot(raw));
		}

		// Trust the plugin's own cursor rather than recomputing max(id): it is correct even when the
		// page was capped by `limit`, which is what makes consecutive pages contiguous.
		cursor = Number(pick(result, "cursor", cursor));

		if (!pick(result, "more", false)) {
			break;
		}

		if (Date.now() >= deadline || pages >= MAX_PAGES) {
			truncated = true;
			break;
		}
	}

	return { snapshots, cursor, head, gap, rewound, truncated, pages };
}

/**
 * Flags the items in a report that break the rules.
 *
 * Takes a report rather than a snapshot on purpose — the caller decides which captures are subject
 * to the rules, which keeps this usable if leave captures ever get their own check.
 */
export function evaluateReport(report: InventoryReport, rules: ItemRulesEntry): ViolationItem[] {
	const listed = new Set<number>((rules.entries ?? []).map(entry => Number(entry.netId)));
	const whitelist = rules.mode === "whitelist";
	const offending: ViolationItem[] = [];

	for (const container of report.containers) {
		for (const item of container.items) {
			const inList = listed.has(item.netId);
			if (whitelist ? inList : !inList) {
				continue;
			}

			offending.push({
				netId: item.netId,
				name: item.name,
				stack: item.stack,
				prefix: item.prefix,
				container: container.name,
				slot: item.slot,
				globalSlot: item.globalSlot,
			});
		}
	}

	return offending;
}
