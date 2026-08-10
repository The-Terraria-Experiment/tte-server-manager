import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { S3Dao } from "../shared/aws/S3.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { buildTShockLogS3Key, type TShockLogStream } from "../shared/utils/tshock/TShockConsoleLogs.js";

type TranscriptBody = {
	date?: string;
	stream?: "out" | "err";
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_EXPIRY_SECONDS = 300;

/**
 * Returns a short-lived presigned S3 URL for a single day's raw TShock log file, rather than
 * proxying the file content through this Lambda/API Gateway — a full day's transcript can exceed
 * Lambda's 6MB synchronous response cap, so the frontend fetches the bytes directly from S3.
 */
export const getTShockLogTranscript = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	const bucket = process.env.S3_LOGS_BUCKET_NAME;
	if (!bucket) {
		return ResponseUtil.Error("Console logs bucket not configured", 500, "MISSING_CONFIG");
	}

	const body = (event.parsedBody || {}) as TranscriptBody;
	const date = body.date;
	if (!date || !DATE_RE.test(date)) {
		return ResponseUtil.ValidationError("date must be formatted as YYYY-MM-DD");
	}

	const stream = body.stream;
	if (stream !== "out" && stream !== "err") {
		return ResponseUtil.ValidationError("stream must be 'out' or 'err'");
	}

	const key = buildTShockLogS3Key(instanceId, stream as TShockLogStream, date);

	const S3 = new S3Dao();
	const objects = await S3.ListObjects(bucket, key);
	const object = objects.find((o) => o.key === key);
	if (!object) {
		return ResponseUtil.NotFoundError("Log transcript");
	}

	const url = await S3.GetSignedDownloadUrl(bucket, key, URL_EXPIRY_SECONDS, `${instanceId}-${stream}-${date}.log`);

	await CWLogger.Action(FUNC_NAMES.LOG_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "get-tshock-log-transcript",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, date, stream, size: object.size },
	});

	return ResponseUtil.Success({ url, size: object.size, lastModified: object.lastModified });
};
