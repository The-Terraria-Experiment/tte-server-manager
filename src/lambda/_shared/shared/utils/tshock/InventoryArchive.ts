import { S3Dao } from "../../aws/S3.js";
import { CWLogger } from "../../aws/CloudWatch.js";
import { CW_LOG_GENERAL } from "../../constants.js";
import type { InventorySnapshot, SnapshotKind } from "./InventorySnapshots.js";
import type { ServerSession, ViolationItem } from "../../schema/SystemTable.js";

/**
 * The S3 layout for archived player inventory snapshots, and the writer that fills it.
 *
 * Lives under its own prefix in the logs bucket beside `tshock-console/` and `metrics/`, exactly as
 * `TShockConsoleLogs.ts` says a new log source should. Deliberately *not* the filestore bucket:
 * anything landing under `{instanceId}/` there becomes a tracked instance file and gets re-synced
 * on every shutdown, forever.
 *
 * ```
 * inventory/{instanceId}/{sessionId}/_session.json
 * inventory/{instanceId}/{sessionId}/{playerSlug}/{paddedId}_{capturedAt}_{kind}.json.gz
 * ```
 *
 * Three things about that layout are load-bearing:
 *
 * 1. **Nothing needs an index to browse it.** `ListObjectsV2` with `Delimiter: "/"` returns sessions
 *    as common prefixes, then players, then captures — and because `sessionId` starts with its own
 *    start time and ids are zero-padded, lexicographic order is the order a human wants.
 * 2. **The metadata a listing renders is in the key.** Capture time and kind come back from the
 *    listing itself, so drawing a hundred rows costs zero `GetObject` calls.
 * 3. **Keys are derived from the snapshot id, so writing is idempotent.** The scan worker archives
 *    *before* it advances its cursor, and a failed drain never writes the cursor — so a retry
 *    re-archives the same ids over the same keys rather than duplicating them.
 */

export const INVENTORY_ARCHIVE_PREFIX = "inventory";

/** Zero-padding for snapshot ids, so lexicographic key order matches numeric id order. */
const SNAPSHOT_ID_PAD = 9;

/** Objects written concurrently. Small enough to stay polite to a single-core box's REST server's peer. */
const ARCHIVE_CONCURRENCY = 8;

export const SESSION_MANIFEST_FILE = "_session.json";

/**
 * A snapshot as stored. The report verbatim, plus where it came from and what the rules made of it
 * at the time.
 *
 * `offending` is recorded here uncapped, unlike `PlayerViolation.items` — that cap exists to bound a
 * Dynamo row, which this is not. Recording the verdict at capture time is what lets the browser ring
 * the offending squares months later without re-evaluating against a rule list that has since
 * changed, which would be a different question than the one that was asked.
 */
export type ArchivedSnapshot = InventorySnapshot & {
	instanceID: string,
	sessionId: string,
	archivedAt: number,
	/** False when the rules were off at capture time — distinct from "evaluated and clean". */
	evaluated: boolean,
	offending?: ViolationItem[],
};

/** What a listing can say about a capture without opening it. */
export type ArchivedSnapshotRef = {
	snapshotId: number,
	capturedAt: number,
	kind: SnapshotKind,
	size: number,
};

/**
 * S3 key segments must survive a round trip back to the player's real name, and Terraria names are
 * user-controlled and can hold anything. Percent-encoding against a strict allowlist is reversible
 * with `decodeURIComponent`, which is the whole reason it is used here rather than a slug or a hash.
 */
export function encodePlayerSegment(name: string): string {
	const encoded = encodeURIComponent(name)
		// encodeURIComponent leaves these alone. They are legal in a key, but keeping the literal set
		// down to `[A-Za-z0-9._-]` means a key can be read at a glance without wondering which
		// punctuation is part of the name and which is structure.
		.replace(/[!'()*~]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

	// A segment of nothing but dots would address a directory rather than a name.
	return /^\.+$/.test(encoded) ? encoded.replace(/\./g, "%2E") : encoded;
}

export function decodePlayerSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		// A hand-made key, or one from a future encoding. Better to show the raw segment than to fail
		// the whole listing over one row.
		return segment;
	}
}

export function instancePrefix(instanceId: string): string {
	return `${INVENTORY_ARCHIVE_PREFIX}/${instanceId}/`;
}

export function sessionPrefix(instanceId: string, sessionId: string): string {
	return `${instancePrefix(instanceId)}${sessionId}/`;
}

export function playerPrefix(instanceId: string, sessionId: string, player: string): string {
	return `${sessionPrefix(instanceId, sessionId)}${encodePlayerSegment(player)}/`;
}

export function sessionManifestKey(instanceId: string, sessionId: string): string {
	return `${sessionPrefix(instanceId, sessionId)}${SESSION_MANIFEST_FILE}`;
}

export function buildSnapshotKey(
	instanceId: string,
	sessionId: string,
	player: string,
	snapshot: { id: number, capturedAt: number, kind: SnapshotKind },
): string {
	const paddedId = String(Math.max(0, snapshot.id)).padStart(SNAPSHOT_ID_PAD, "0");
	return `${playerPrefix(instanceId, sessionId, player)}${paddedId}_${snapshot.capturedAt}_${snapshot.kind}.json.gz`;
}

/** The last segment of a snapshot key back into the fields a listing renders. Null for anything else. */
export function parseSnapshotKey(key: string): Omit<ArchivedSnapshotRef, "size"> | null {
	const fileName = key.split("/").pop() ?? "";
	const match = /^(\d+)_(\d+)_(join|leave)\.json\.gz$/.exec(fileName);
	if (!match) {
		return null;
	}

	return {
		snapshotId: Number(match[1]),
		capturedAt: Number(match[2]),
		kind: match[3] as SnapshotKind,
	};
}

/** The `{sessionId}` out of a common prefix like `inventory/i-123/2026-…-000007/`. */
export function parseSessionPrefix(instanceId: string, prefix: string): string | null {
	const base = instancePrefix(instanceId);
	if (!prefix.startsWith(base)) {
		return null;
	}
	const remainder = prefix.slice(base.length).replace(/\/$/, "");
	return remainder && !remainder.includes("/") ? remainder : null;
}

/** The `{playerSlug}` out of a common prefix, decoded back to the player's real name. */
export function parsePlayerPrefix(instanceId: string, sessionId: string, prefix: string): string | null {
	const base = sessionPrefix(instanceId, sessionId);
	if (!prefix.startsWith(base)) {
		return null;
	}
	const remainder = prefix.slice(base.length).replace(/\/$/, "");
	return remainder && !remainder.includes("/") ? decodePlayerSegment(remainder) : null;
}

/**
 * Writes the session record beside its captures, once, when the session is first archived against.
 *
 * The Dynamo row is the live source of truth, but its history ring is capped and its `current` is
 * overwritten by the next launch — so without this, an archive outliving 50 sessions would have
 * folders it could no longer name. Storing it here means the archive explains itself.
 */
export async function writeSessionManifest(bucketName: string, session: ServerSession): Promise<void> {
	const S3 = new S3Dao();
	await S3.PutJsonObject(bucketName, sessionManifestKey(session.instanceID, session.sessionId), session);
}

export async function readSessionManifest(
	bucketName: string,
	instanceId: string,
	sessionId: string,
): Promise<ServerSession | null> {
	const S3 = new S3Dao();
	const raw = await S3.GetObject(bucketName, sessionManifestKey(instanceId, sessionId));
	if (!raw) {
		return null;
	}

	try {
		return JSON.parse(raw) as ServerSession;
	} catch {
		return null;
	}
}

export type ArchiveOptions = {
	kinds: SnapshotKind[];
	/** Wall-clock ceiling for the whole batch. The worker is async, so this is ours to pick. */
	budgetMs?: number;
	/** Rule verdicts by snapshot id, for the captures the caller evaluated. */
	verdicts?: Map<number, ViolationItem[]>;
	/** False when the rules were off, so an absent verdict reads as "not checked" rather than "clean". */
	evaluated?: boolean;
};

export type ArchiveResult = {
	written: number;
	/** Filtered out by `kinds`, or a capture with no player name to file it under. */
	skipped: number;
	failed: number;
	/** Ran out of budget with captures still unwritten. Those are lost — see the note in the scan worker. */
	truncated: boolean;
};

/**
 * Persists a drain's captures.
 *
 * **Never throws.** Archiving is best-effort by the same contract as the shutdown tasks: the scan
 * that produced these snapshots is a moderation feature that has to keep working when S3 does not.
 * The cost of that choice is real and worth stating plainly — the caller advances its cursor whether
 * or not these writes landed, so a capture whose put failed is gone rather than retried.
 */
export async function archiveSnapshots(
	bucketName: string,
	instanceId: string,
	sessionId: string,
	snapshots: InventorySnapshot[],
	options: ArchiveOptions,
): Promise<ArchiveResult> {
	const { kinds, budgetMs = 10000, verdicts, evaluated = false } = options;
	const deadline = Date.now() + budgetMs;
	const S3 = new S3Dao();

	const result: ArchiveResult = { written: 0, skipped: 0, failed: 0, truncated: false };

	const eligible = snapshots.filter(snapshot => {
		if (!kinds.includes(snapshot.kind) || !snapshot.player?.name) {
			result.skipped++;
			return false;
		}
		return true;
	});

	for (let index = 0; index < eligible.length; index += ARCHIVE_CONCURRENCY) {
		if (Date.now() >= deadline) {
			result.truncated = true;
			result.skipped += eligible.length - index;
			break;
		}

		const batch = eligible.slice(index, index + ARCHIVE_CONCURRENCY);
		const outcomes = await Promise.allSettled(batch.map(async snapshot => {
			const offending = verdicts?.get(snapshot.id);
			const stored: ArchivedSnapshot = {
				...snapshot,
				instanceID: instanceId,
				sessionId,
				archivedAt: Date.now(),
				evaluated,
				...(offending?.length ? { offending } : {}),
			};

			await S3.PutGzipJsonObject(
				bucketName,
				buildSnapshotKey(instanceId, sessionId, snapshot.player.name, snapshot),
				stored,
			);
		}));

		for (const outcome of outcomes) {
			if (outcome.status === "fulfilled") {
				result.written++;
			} else {
				result.failed++;
			}
		}
	}

	if (result.failed || result.truncated) {
		// Logged here rather than left to the caller: the caller reports counts, and a count with no
		// reason behind it is the kind of thing nobody can act on six weeks later.
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "inventory-archive",
			error: result.truncated
				? "Ran out of archive budget; unwritten captures are not retried"
				: "One or more snapshot writes failed",
			details: { instanceId, sessionId, ...result },
		});
	}

	return result;
}
