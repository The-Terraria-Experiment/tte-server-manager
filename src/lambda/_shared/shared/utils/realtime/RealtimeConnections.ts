import { DynamoDao } from "../../aws/DynamoDB.js";
import { SYSTEM_TABLE } from "../../vars.js";
import type { RealtimeConnectionEntry } from "../../schema/SystemTable.js";
import {
	REALTIME_CONN_INDEX,
	REALTIME_CONN_RECORD_TYPE,
	realtimeConnectionKey,
} from "./RealtimeEvents.js";

/**
 * The live WebSocket connection registry, in the per-environment system table.
 *
 * Reads go through the sparse `recordType-index` GSI rather than a prefix scan, so the cost of a
 * publish scales with the number of open browsers instead of the size of the whole table. See
 * `RealtimeEvents.REALTIME_CONN_INDEX` for why a sparse index is safe to add to a table full of
 * unrelated record types.
 */

/** A connection row still present after this long is garbage: API Gateway hard-kills at 2h. */
const CONNECTION_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * How long a warm container may reuse its connection list.
 *
 * Safe for the same reason the GSI's eventual consistency is safe: a connection that misses events
 * for its first few seconds is covered by the full refetch it performs on open. The win is that a
 * burst of player joins arriving at one container queries once instead of once per event.
 */
const LIST_CACHE_MS = 5000;

let cachedConnections: RealtimeConnectionEntry[] | null = null;
let cachedAt = 0;

export class RealtimeConnections {
	/**
	 * Records a newly connected client. `recordType` is written unconditionally — it is the GSI
	 * partition key, and a row without it is invisible to fan-out with no error to notice.
	 */
	public static async Put(params: {
		connectionId: string;
		userSub: string;
		apiEndpoint: string;
	}): Promise<boolean> {
		const now = Date.now();
		const entry: RealtimeConnectionEntry = {
			uid: realtimeConnectionKey(params.connectionId),
			recordType: REALTIME_CONN_RECORD_TYPE,
			connectionId: params.connectionId,
			userSub: params.userSub,
			apiEndpoint: params.apiEndpoint,
			connectedAt: now,
			lastSeenAt: now,
			expireAt: Math.floor((now + CONNECTION_TTL_MS) / 1000),
		};

		const ok = await new DynamoDao().PutItem(SYSTEM_TABLE, entry);
		RealtimeConnections.DropCache();
		return ok;
	}

	public static async Delete(connectionId: string): Promise<boolean> {
		const ok = await new DynamoDao().DeleteItem(SYSTEM_TABLE, realtimeConnectionKey(connectionId));
		RealtimeConnections.DropCache();
		return ok;
	}

	/**
	 * Marks a connection as alive, in response to a client ping.
	 *
	 * Only touches `lastSeenAt`, which is deliberately *not* projected into the GSI — a GSI is
	 * rewritten only when a projected attribute changes, so the ~4-minute heartbeat from every open
	 * browser costs nothing in index writes.
	 */
	public static async Touch(connectionId: string): Promise<void> {
		await new DynamoDao().UpdateItem(SYSTEM_TABLE, realtimeConnectionKey(connectionId), {
			updates: { lastSeenAt: Date.now() },
			ConditionExpression: "attribute_exists(uid)",
		});
	}

	/**
	 * Every live connection for this environment.
	 *
	 * Pages the Query to completion: a publish that silently stopped at the first page would deliver
	 * to an arbitrary subset of operators with nothing anywhere to indicate it had.
	 */
	public static async List(): Promise<RealtimeConnectionEntry[]> {
		if (cachedConnections && Date.now() - cachedAt < LIST_CACHE_MS) {
			return cachedConnections;
		}

		const DB = new DynamoDao();
		const connections: RealtimeConnectionEntry[] = [];
		let startKey: Record<string, unknown> | undefined = undefined;

		do {
			const page = await DB.Query(SYSTEM_TABLE, {
				indexName: REALTIME_CONN_INDEX,
				keyCondition: "#rt = :rt",
				expressionAttributeNames: { "#rt": "recordType" },
				expressionAttributeValues: { ":rt": REALTIME_CONN_RECORD_TYPE },
				...(startKey ? { exclusiveStartKey: startKey } : {}),
			});

			connections.push(...(page.items as RealtimeConnectionEntry[]));
			startKey = page.lastKey ?? undefined;
		} while (startKey);

		// TTL deletion runs on its own schedule (routinely tens of minutes late), so skip anything
		// already past its expiry rather than paying a doomed post for it.
		const nowSeconds = Math.floor(Date.now() / 1000);
		const live = connections.filter((c) => !c.expireAt || c.expireAt > nowSeconds);

		cachedConnections = live;
		cachedAt = Date.now();
		return live;
	}

	/** Called by every write so a warm container can't serve a list it just invalidated. */
	public static DropCache(): void {
		cachedConnections = null;
		cachedAt = 0;
	}
}
