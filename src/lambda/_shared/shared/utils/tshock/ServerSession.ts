import { DynamoDao } from "../../aws/DynamoDB.js";
import { SERVER_SESSION_KEY, SYSTEM_TABLE } from "../../vars.js";
import type {
	ServerSession,
	ServerSessionEndReason,
	SystemServerSessionEntry,
} from "../../schema/SystemTable.js";

/**
 * The record of which run of a TShock server is currently going, per instance.
 *
 * There was no such concept before this: `AutoShutoffStateEntry.serverStartedAt` is a bare timestamp
 * written by one caller and read only as an idle-grace anchor, and the snapshot scanner's `rewound`
 * flag — which genuinely does detect a restart — reached a CloudWatch field and nothing else. Neither
 * gives anything a stable name for "the run of the server that was going when X happened", which is
 * the axis anything historical needs between an instance and an event.
 *
 * So this module owns one thing and knows about nothing else. It has no idea what an inventory
 * snapshot is, and the archive that keys its S3 layout on `sessionId` is a consumer, not an owner.
 *
 * **Sessions are minted at launch and closed at stop.** A restart that did not go through us is
 * reconciled after the fact by whatever notices — today that is the scanner, via
 * {@link rollSession} — but the launch path is the authoritative one, and the only one that knows
 * the real start time, the world, and who asked for it.
 *
 * Concurrency: the launch path is already single-writer (guarded by `launchWorld`'s
 * `TSHOCK_ALREADY_RUNNING` pre-launch check), and the scanner's calls run under the scan lease. A
 * launch racing a drain is possible but narrow. `seq` is incremented with `ADD` so two sessions can
 * never be issued the same id whatever the interleaving; everything else is last-writer-wins, which
 * is the right trade for a record whose worst failure is a mislabelled boundary.
 */

/** Ended sessions kept on the row. See {@link SystemServerSessionEntry.recent} for why it's an array. */
export const SESSION_HISTORY_CAP = 50;

/** Marker used as `startedBy` for a session nobody asked us for. */
export const DETECTED_SESSION_ACTOR = "[detected]";

export function serverSessionKey(instanceId: string): string {
	return `${SERVER_SESSION_KEY}#${instanceId}`;
}

/**
 * `2026-08-13T18-22-10Z-000007`.
 *
 * Colons and dots are not illegal in an S3 key, but they are awkward in a URL and in a shell, and
 * this string is both a key segment and a query parameter. Dashing them keeps it lexicographically
 * sortable — which is what makes a plain `ListObjectsV2` return sessions in order.
 */
export function buildSessionId(startedAt: number, seq: number): string {
	const stamp = new Date(startedAt).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:.]/g, "-");
	return `${stamp}-${String(seq).padStart(6, "0")}`;
}

/**
 * Only ids this module could have produced, so a caller can't reach an arbitrary S3 prefix.
 *
 * `\d{6,}` rather than exactly six: the padding is a minimum width for sorting, not a limit, and an
 * instance that somehow passed a million launches must not have its whole archive become
 * unaddressable by a validator that was stricter than the minter.
 */
export function isValidSessionId(value: unknown): value is string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-\d{6,}$/.test(value);
}

export async function readSessionState(instanceId: string): Promise<SystemServerSessionEntry | null> {
	const DB = new DynamoDao();
	return (await DB.GetItem(SYSTEM_TABLE, serverSessionKey(instanceId))) as SystemServerSessionEntry | null;
}

/** The open session, or null when no server is known to be running on this instance. */
export async function getCurrentSession(instanceId: string): Promise<ServerSession | null> {
	const state = await readSessionState(instanceId);
	return state?.current ?? null;
}

export type SessionInit = {
	startedAt?: number,
	startedBy: string,
	source: ServerSession["source"],
	worldFilePath?: string,
	port?: number,
	maxPlayers?: number,
};

/**
 * Opens a new session, closing any session still open on this instance.
 *
 * The close is not tidiness: a server that went away without us seeing it (an instance stopped
 * outside the app, a crash, a `kill`) leaves `current` set forever, and treating that as live would
 * make every later run look like a continuation of it. `"superseded"` records that we never saw it
 * end, rather than inventing an end time.
 */
export async function beginServerSession(instanceId: string, init: SessionInit): Promise<ServerSession> {
	const DB = new DynamoDao();
	const startedAt = init.startedAt ?? Date.now();

	// Read before the bump, so `state.seq` is the pre-bump counter and doubles as the fallback below.
	// `state.current` is untouched by the bump either way.
	const state = await readSessionState(instanceId);

	// ADD, then read the result: the returned counter is this caller's alone even if another writer
	// incremented it a moment later, so the id it builds cannot collide.
	const bumped = await DB.UpdateItem(SYSTEM_TABLE, serverSessionKey(instanceId), {
		UpdateExpression: "SET #instanceID = :instance ADD #seq :one",
		ExpressionAttributeNames: { "#instanceID": "instanceID", "#seq": "seq" },
		ExpressionAttributeValues: { ":instance": instanceId, ":one": 1 },
		ReturnValues: "UPDATED_NEW",
	});

	// `UpdateItem` swallows its errors and returns null, so this is also the write-failed path. Falling
	// back to the counter we read keeps the id inside the format everything else validates against —
	// a wall-clock fallback would mint a session that `isValidSessionId` then refuses to address, so
	// its captures would be written somewhere nothing could ever browse.
	const seq = typeof bumped?.seq === "number" ? bumped.seq : (state?.seq ?? 0) + 1;

	const session: ServerSession = {
		sessionId: buildSessionId(startedAt, seq),
		instanceID: instanceId,
		seq,
		startedAt,
		startedBy: init.startedBy,
		source: init.source,
		...(init.worldFilePath ? { worldFilePath: init.worldFilePath } : {}),
		...(typeof init.port === "number" ? { port: init.port } : {}),
		...(typeof init.maxPlayers === "number" ? { maxPlayers: init.maxPlayers } : {}),
	};

	const recent = closeInto(state, { endedAt: startedAt, endReason: "superseded" });

	await DB.UpdateItem(SYSTEM_TABLE, serverSessionKey(instanceId), {
		updates: {
			instanceID: instanceId,
			current: session,
			recent,
			updatedAt: new Date().toISOString(),
		},
	});

	return session;
}

export type SessionEnd = {
	endedBy?: string,
	reason: ServerSessionEndReason,
	endedAt?: number,
};

/**
 * Closes the open session, if there is one.
 *
 * A no-op when nothing is open, deliberately — every caller sits on a path that may or may not have
 * had a server running (the shutdown job's graceful stop is the common case, and a box with no
 * server is its normal state), and none of them should have to check first.
 */
export async function endServerSession(instanceId: string, end: SessionEnd): Promise<ServerSession | null> {
	const state = await readSessionState(instanceId);
	if (!state?.current) {
		return null;
	}

	const endedAt = end.endedAt ?? Date.now();
	const closed: ServerSession = {
		...state.current,
		endedAt,
		...(end.endedBy ? { endedBy: end.endedBy } : {}),
		endReason: end.reason,
	};

	const DB = new DynamoDao();
	await DB.UpdateItem(SYSTEM_TABLE, serverSessionKey(instanceId), {
		updates: {
			instanceID: instanceId,
			current: null,
			recent: [closed, ...(state.recent ?? [])].slice(0, SESSION_HISTORY_CAP),
			updatedAt: new Date().toISOString(),
		},
	});

	return closed;
}

/**
 * The open session, or a newly minted `"detected"` one.
 *
 * For everything that finds a server running without having started it — a box launched over SSH, a
 * session that predates this module, or a `beginServerSession` that failed after the launch went
 * out. `anchorAt` should be the earliest activity the caller actually observed (a snapshot's capture
 * time, say) rather than `Date.now()`, since that is the closest thing to a start time available.
 */
export async function ensureSession(
	instanceId: string,
	options: { anchorAt?: number, startedBy?: string } = {},
): Promise<ServerSession> {
	const current = await getCurrentSession(instanceId);
	if (current) {
		return current;
	}

	return beginServerSession(instanceId, {
		...(typeof options.anchorAt === "number" ? { startedAt: options.anchorAt } : {}),
		startedBy: options.startedBy ?? DETECTED_SESSION_ACTOR,
		source: "detected",
	});
}

/**
 * Ends the open session and opens a new one — for a restart observed after the fact.
 *
 * The end time is the new session's anchor rather than now: the restart happened somewhere between
 * the two, and dating the old session to the moment we *noticed* would overlap it with the new one.
 */
export async function rollSession(
	instanceId: string,
	options: { anchorAt?: number, reason?: ServerSessionEndReason, startedBy?: string } = {},
): Promise<ServerSession> {
	const anchorAt = options.anchorAt ?? Date.now();

	await endServerSession(instanceId, {
		reason: options.reason ?? "restart-detected",
		endedAt: anchorAt,
	});

	return beginServerSession(instanceId, {
		startedAt: anchorAt,
		startedBy: options.startedBy ?? DETECTED_SESSION_ACTOR,
		source: "detected",
	});
}

/** The `recent` ring with the row's open session (if any) closed into the front of it. */
function closeInto(
	state: SystemServerSessionEntry | null,
	end: { endedAt: number, endReason: ServerSessionEndReason },
): ServerSession[] {
	const recent = state?.recent ?? [];
	if (!state?.current) {
		return recent.slice(0, SESSION_HISTORY_CAP);
	}

	const closed: ServerSession = { ...state.current, endedAt: end.endedAt, endReason: end.endReason };
	return [closed, ...recent].slice(0, SESSION_HISTORY_CAP);
}
