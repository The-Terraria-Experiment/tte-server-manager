import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { S3Dao } from "../shared/aws/S3.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { parseTShockLogKey, tshockLogPrefix, type TShockLogStream } from "../shared/utils/tshock/TShockConsoleLogs.js";

type LogFileEntry = {
	date: string;
	stream: TShockLogStream;
	size: number;
	lastModified: string | undefined;
};

/**
 * Lists the TShock console log files actually present in S3 for an instance, so the UI can offer
 * a concrete list to pick from rather than guessing at dates. A month of retention over two
 * streams is well under the ListObjectsV2 single-page cap, so no pagination is needed here.
 */
export const listTShockLogs = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	const bucket = process.env.S3_LOGS_BUCKET_NAME;
	if (!bucket) {
		return ResponseUtil.Error("Console logs bucket not configured", 500, "MISSING_CONFIG");
	}

	const S3 = new S3Dao();
	const objects = await S3.ListObjects(bucket, tshockLogPrefix(instanceId));

	const files: LogFileEntry[] = [];
	for (const object of objects) {
		const parsed = parseTShockLogKey(instanceId, object.key);
		if (!parsed) continue;
		files.push({
			date: parsed.date,
			stream: parsed.stream,
			size: object.size,
			lastModified: object.lastModified ? object.lastModified.toISOString() : undefined,
		});
	}

	// Newest first, out before err on the same day.
	files.sort((a, b) => (a.date === b.date ? a.stream.localeCompare(b.stream) : b.date.localeCompare(a.date)));

	await CWLogger.Action(FUNC_NAMES.LOG_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "list-tshock-logs",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, fileCount: files.length },
	});

	return ResponseUtil.Success({ files });
};
