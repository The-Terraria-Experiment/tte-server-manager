import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { S3Dao } from "../shared/aws/S3.js";
import { buildSnapshotKey } from "../shared/utils/tshock/InventoryArchive.js";
import { isValidSessionId } from "../shared/utils/tshock/ServerSession.js";
import type { ArchivedSnapshot } from "../shared/utils/tshock/InventoryArchive.js";

const KINDS = new Set(["join", "leave"]);

/**
 * One archived capture, in full.
 *
 * Returned inline rather than as a presigned URL. `getTShockLogTranscript` hands out a URL because a
 * day of console output can exceed Lambda's 6MB synchronous response cap; an inventory report is a
 * couple hundred KB, so the extra round trip would buy nothing and cost the caller a second request
 * plus a CORS surface on the bucket.
 *
 * The key is rebuilt from the addressing parameters rather than accepted from the client, so there is
 * no path this endpoint can be pointed at an object outside this instance's own archive.
 */
export const readSnapshot = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	const params = event.queryStringParameters ?? {};
	const sessionID = params.session;
	if (!isValidSessionId(sessionID)) {
		return ResponseUtil.ValidationError("A valid session ID is required");
	}

	const player = params.player;
	if (!player) {
		return ResponseUtil.ValidationError("A player name is required");
	}

	const snapshotId = Number(params.id);
	if (!Number.isInteger(snapshotId) || snapshotId < 0) {
		return ResponseUtil.ValidationError("A valid snapshot ID is required");
	}

	const capturedAt = Number(params.capturedAt);
	if (!Number.isInteger(capturedAt) || capturedAt <= 0) {
		return ResponseUtil.ValidationError("A valid capture timestamp is required");
	}

	const kind = String(params.kind ?? "join");
	if (!KINDS.has(kind)) {
		return ResponseUtil.ValidationError("Kind must be 'join' or 'leave'");
	}

	const bucket = process.env.S3_LOGS_BUCKET_NAME;
	if (!bucket) {
		return ResponseUtil.Error("Snapshot archive storage is not configured", 500, "MISSING_CONFIG");
	}

	const key = buildSnapshotKey(serverID, sessionID, player, {
		id: snapshotId,
		capturedAt,
		kind: kind as "join" | "leave",
	});

	const S3 = new S3Dao();
	const snapshot = await S3.GetGzipJsonObject<ArchivedSnapshot>(bucket, key);

	if (!snapshot) {
		// Also what an expired capture looks like — the bucket's lifecycle rule deletes these on a
		// schedule, so a link into the archive goes stale rather than staying valid forever.
		return ResponseUtil.NotFoundError("Snapshot");
	}

	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-snapshot",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { serverID, sessionID, player, snapshotId, kind },
	});

	return ResponseUtil.Success({ snapshot });
};
