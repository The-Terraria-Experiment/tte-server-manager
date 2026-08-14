import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { S3Dao } from "../shared/aws/S3.js";
import { instancePrefix, parseSessionPrefix } from "../shared/utils/tshock/InventoryArchive.js";
import { archiveKinds, isArchiveActive, readItemRules } from "../shared/utils/jobs/ItemRuleScan.js";
import { getCurrentSession } from "../shared/utils/tshock/ServerSession.js";

/**
 * The sessions this instance has archived snapshots for, newest first, plus the archive settings.
 *
 * Sessions come from S3 common prefixes rather than from the Dynamo session row, and that is the
 * point: the row's history ring is capped and its `current` is overwritten by the next launch, so it
 * is a record of *sessions*, not of *what has been archived*. Listing what is actually in the bucket
 * means the browser can never offer a session whose captures have aged out of the lifecycle rule, or
 * miss one older than the ring.
 *
 * `sessionId` starts with the session's own start time, so lexicographic order is chronological and
 * the list needs no metadata to sort or label itself. The per-session manifest is read only when a
 * session is actually opened — see `listSnapshotPlayers`. Drawing this list costs one `ListObjectsV2`.
 *
 * The archive config rides along with a `configured` flag, exactly as the metrics config read does:
 * `archiveKinds` fabricates a default when nothing is stored, so without the flag an instance that
 * has never archived anything would read back as a confident "enabled, joins only".
 */
export const listSnapshotSessions = async (
	event: AuthorizedEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	const bucket = process.env.S3_LOGS_BUCKET_NAME;
	if (!bucket) {
		return ResponseUtil.Error("Snapshot archive storage is not configured", 500, "MISSING_CONFIG");
	}

	const rules = await readItemRules(serverID);
	const archive = {
		enabled: isArchiveActive(rules),
		kinds: archiveKinds(rules),
	};

	const S3 = new S3Dao();
	const listing = await S3.ListObjectsPage(bucket, {
		prefix: instancePrefix(serverID),
		delimiter: "/",
	});

	const sessions = listing.prefixes
		.map(prefix => parseSessionPrefix(serverID, prefix))
		.filter((sessionId): sessionId is string => Boolean(sessionId))
		.sort()
		.reverse();

	// The open session may have no captures yet, so it can be absent from the listing above. Reported
	// separately rather than merged in, so "this run is live" and "this run has archived data" stay
	// distinguishable — an operator looking for a capture that isn't there needs to know which it is.
	const current = await getCurrentSession(serverID);

	return ResponseUtil.Success({
		serverID,
		archive,
		/** Whether an operator has ever set these, as opposed to reading back manufactured defaults. */
		configured: Boolean(rules?.archive),
		sessions,
		currentSessionID: current?.sessionId ?? null,
		truncated: Boolean(listing.nextToken),
	});
};
