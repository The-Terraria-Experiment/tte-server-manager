import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { S3Dao } from "../shared/aws/S3.js";
import { instancePrefix, parseSessionPrefix } from "../shared/utils/tshock/InventoryArchive.js";
import { archiveKinds, isArchiveActive, readItemRules } from "../shared/utils/jobs/ItemRuleScan.js";
import { readSessionState } from "../shared/utils/tshock/ServerSession.js";

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
 * the list needs no metadata to sort or label itself. Each entry also carries `worldFilePath` when the
 * Dynamo session row still remembers it (see below); the per-session manifest in S3 is still read only
 * when a session is actually opened — see `listSnapshotPlayers`. Drawing this list costs one
 * `ListObjectsV2` plus one `GetItem`.
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

	// The Dynamo session row, not S3, is where `worldFilePath` lives — reading it here is one `GetItem`
	// against a row already needed for `currentSessionID`, versus a `GetObject` per session for the
	// manifest `writeSessionManifest` puts beside the captures. That keeps this listing at its documented
	// cost of one `ListObjectsV2` plus one `GetItem`, at the price of only labelling what the row's
	// bounded `recent` ring still remembers — a session old enough to have aged out of it (or older than
	// this module) shows no world name, same as `configured` reading a manufactured default.
	const state = await readSessionState(serverID);
	const worldFilePaths = new Map<string, string>();
	if (state?.current?.worldFilePath) {
		worldFilePaths.set(state.current.sessionId, state.current.worldFilePath);
	}
	for (const session of state?.recent ?? []) {
		if (session.worldFilePath && !worldFilePaths.has(session.sessionId)) {
			worldFilePaths.set(session.sessionId, session.worldFilePath);
		}
	}

	const sessions = listing.prefixes
		.map(prefix => parseSessionPrefix(serverID, prefix))
		.filter((sessionId): sessionId is string => Boolean(sessionId))
		.sort()
		.reverse()
		.map(sessionId => ({ sessionId, worldFilePath: worldFilePaths.get(sessionId) ?? null }));

	return ResponseUtil.Success({
		serverID,
		archive,
		/** Whether an operator has ever set these, as opposed to reading back manufactured defaults. */
		configured: Boolean(rules?.archive),
		sessions,
		// The open session may have no captures yet, so it can be absent from the listing above. Reported
		// separately rather than merged in, so "this run is live" and "this run has archived data" stay
		// distinguishable — an operator looking for a capture that isn't there needs to know which it is.
		currentSessionID: state?.current?.sessionId ?? null,
		truncated: Boolean(listing.nextToken),
	});
};
