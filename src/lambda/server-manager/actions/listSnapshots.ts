import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { S3Dao } from "../shared/aws/S3.js";
import { parseSnapshotKey, playerPrefix } from "../shared/utils/tshock/InventoryArchive.js";
import { isValidSessionId } from "../shared/utils/tshock/ServerSession.js";
import type { ArchivedSnapshotRef } from "../shared/utils/tshock/InventoryArchive.js";

/**
 * Pages walked before giving up. One page is 1000 keys — a player would have to join and leave five
 * thousand times inside a single server run to reach the end of this, so in practice the first page
 * exhausts the prefix and the guard only exists so a pathological prefix can't hold the request open.
 */
const MAX_PAGES = 5;

/**
 * One player's captures within a session, newest first.
 *
 * Nothing is opened to build this list. Capture time, kind and snapshot id are all encoded in the key
 * itself, precisely so that rendering a hundred rows costs one `ListObjectsV2` and zero `GetObject`s
 * — the reports behind them are a couple of hundred KB each, and a listing that read them would be
 * megabytes of transfer to draw a table of timestamps.
 *
 * **The prefix is drained before it is sorted, rather than paginated through to the client, and that
 * is a correctness point rather than a simplification.** S3 lists lexicographically ascending with no
 * reverse option, so handing back one page at a time would hand back the *oldest* captures first —
 * and the caller almost always wants the most recent. Draining first means "newest" means newest.
 * The same reasoning caps truncation as the one failure worth flagging: if the guard above is ever
 * hit, what is returned is the oldest slice, which is exactly the wrong half, so `truncated` says so
 * rather than letting it pass as a complete answer.
 */
export const listSnapshots = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	const sessionID = event.queryStringParameters?.session;
	if (!isValidSessionId(sessionID)) {
		return ResponseUtil.ValidationError("A valid session ID is required");
	}

	const player = event.queryStringParameters?.player;
	if (!player) {
		return ResponseUtil.ValidationError("A player name is required");
	}

	const bucket = process.env.S3_LOGS_BUCKET_NAME;
	if (!bucket) {
		return ResponseUtil.Error("Snapshot archive storage is not configured", 500, "MISSING_CONFIG");
	}

	const S3 = new S3Dao();
	const prefix = playerPrefix(serverID, sessionID, player);
	const snapshots: ArchivedSnapshotRef[] = [];

	let cursor: string | null = null;
	let truncated = false;

	for (let page = 0; page < MAX_PAGES; page++) {
		const listing: Awaited<ReturnType<S3Dao["ListObjectsPage"]>> = await S3.ListObjectsPage(bucket, {
			prefix,
			...(cursor ? { continuationToken: cursor } : {}),
		});

		for (const object of listing.objects) {
			const parsed = parseSnapshotKey(object.key);
			if (parsed) {
				snapshots.push({ ...parsed, size: object.size });
			}
		}

		cursor = listing.nextToken;
		if (!cursor) {
			break;
		}

		truncated = page === MAX_PAGES - 1;
	}

	// Newest first. S3 hands them back ascending, which is why the whole prefix had to be drained
	// before this point — see the note above.
	snapshots.sort((a, b) => b.snapshotId - a.snapshotId);

	return ResponseUtil.Success({
		serverID,
		sessionID,
		player,
		snapshots,
		truncated,
	});
};
