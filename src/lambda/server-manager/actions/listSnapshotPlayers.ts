import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { S3Dao } from "../shared/aws/S3.js";
import { parsePlayerPrefix, readSessionManifest, sessionPrefix } from "../shared/utils/tshock/InventoryArchive.js";
import { isValidSessionId } from "../shared/utils/tshock/ServerSession.js";

/**
 * The players with archived captures in one session, and that session's own record.
 *
 * The manifest is fetched here rather than in the session list because a library of sessions would
 * otherwise cost one `GetObject` per row to render, for metadata nobody has asked to see yet.
 * Opening a session is exactly when it becomes worth reading.
 *
 * `session` may be null for an archive written before the manifest existed, or one whose manifest
 * write failed — the captures are still there and still browsable, so this is a missing label rather
 * than an error.
 */
export const listSnapshotPlayers = async (
	event: AuthorizedEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	const sessionID = event.queryStringParameters?.session;
	// Validated against the minting format rather than merely sanitized: this becomes an S3 prefix, and
	// only ids this system could have issued should ever address one.
	if (!isValidSessionId(sessionID)) {
		return ResponseUtil.ValidationError("A valid session ID is required");
	}

	const bucket = process.env.S3_LOGS_BUCKET_NAME;
	if (!bucket) {
		return ResponseUtil.Error("Snapshot archive storage is not configured", 500, "MISSING_CONFIG");
	}

	const S3 = new S3Dao();
	const listing = await S3.ListObjectsPage(bucket, {
		prefix: sessionPrefix(serverID, sessionID),
		delimiter: "/",
	});

	const players = listing.prefixes
		.map(prefix => parsePlayerPrefix(serverID, sessionID, prefix))
		.filter((player): player is string => Boolean(player))
		.sort((a, b) => a.localeCompare(b));

	return ResponseUtil.Success({
		serverID,
		sessionID,
		session: await readSessionManifest(bucket, serverID, sessionID),
		players,
		truncated: Boolean(listing.nextToken),
	});
};
