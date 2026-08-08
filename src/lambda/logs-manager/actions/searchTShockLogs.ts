import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { S3Dao } from "../shared/aws/S3.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { buildTShockLogS3Key, type TShockLogStream } from "../shared/utils/tshock/TShockConsoleLogs.js";
import { isoDate, enumerateDateRangeDesc } from "../shared/utils/core/LogDateRanges.js";

type SearchBody = {
	pattern?: string;
	useRegex?: boolean;
	stream?: "out" | "err" | "both";
	startDate?: string;
	endDate?: string;
	caseSensitive?: boolean;
	maxResults?: number;
};

type LogMatch = {
	date: string;
	stream: TShockLogStream;
	lineNumber: number;
	line: string;
};

const DEFAULT_RESULTS = 200;
const MAX_RESULTS_CAP = 500;
const MAX_DATE_RANGE_DAYS = 31;
const BATCH_SIZE = 8;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const searchTShockLogs = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	const bucket = process.env.S3_LOGS_BUCKET_NAME;
	if (!bucket) {
		return ResponseUtil.Error("Console logs bucket not configured", 500, "MISSING_CONFIG");
	}

	const body = (event.parsedBody || {}) as SearchBody;
	const pattern = typeof body.pattern === "string" ? body.pattern : "";
	if (!pattern) {
		return ResponseUtil.ValidationError("pattern is required");
	}
	if (pattern.length > 500) {
		return ResponseUtil.ValidationError("pattern is too long");
	}

	const streamParam = body.stream ?? "both";
	if (!["out", "err", "both"].includes(streamParam)) {
		return ResponseUtil.ValidationError("Invalid stream");
	}
	const streams: TShockLogStream[] = streamParam === "both" ? ["out", "err"] : [streamParam as TShockLogStream];

	const endDate = body.endDate ?? isoDate(new Date());
	const startDate = body.startDate ?? isoDate(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));

	if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
		return ResponseUtil.ValidationError("startDate/endDate must be formatted as YYYY-MM-DD");
	}
	if (startDate > endDate) {
		return ResponseUtil.ValidationError("startDate must be <= endDate");
	}

	const dates = enumerateDateRangeDesc(startDate, endDate);
	if (dates.length > MAX_DATE_RANGE_DAYS) {
		return ResponseUtil.ValidationError(`Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`);
	}

	let regex: RegExp;
	try {
		const source = body.useRegex ? pattern : escapeRegExp(pattern);
		regex = new RegExp(source, body.caseSensitive === false ? "i" : "");
	} catch (e: any) {
		return ResponseUtil.ValidationError("Invalid pattern: " + (e?.message ?? "unknown"));
	}

	const maxResults = Math.min(Math.max(1, Number(body.maxResults) || DEFAULT_RESULTS), MAX_RESULTS_CAP);

	// Most-recent-day-first so a truncated scan favors recent activity over older history.
	const targets: Array<{ date: string; stream: TShockLogStream; key: string }> = [];
	for (const date of dates) {
		for (const stream of streams) {
			targets.push({ date, stream, key: buildTShockLogS3Key(instanceId, stream, date) });
		}
	}

	const S3 = new S3Dao();
	const matches: LogMatch[] = [];
	let filesScanned = 0;
	let truncated = false;

	for (let i = 0; i < targets.length && matches.length < maxResults; i += BATCH_SIZE) {
		const batch = targets.slice(i, i + BATCH_SIZE);
		const contents = await Promise.all(batch.map((t) => S3.GetObject(bucket, t.key)));

		for (let j = 0; j < batch.length; j++) {
			const target = batch[j];
			const content = contents[j];
			if (!target || content === false || content === undefined) continue;
			filesScanned++;

			const lines = content.split("\n");
			for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				if (matches.length >= maxResults) {
					truncated = true;
					break;
				}
				const line = lines[lineIndex];
				if (line !== undefined && regex.test(line)) {
					matches.push({ date: target.date, stream: target.stream, lineNumber: lineIndex + 1, line });
				}
			}

			if (truncated) break;
		}
	}

	await CWLogger.Action(FUNC_NAMES.LOG_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "search-tshock-logs",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, streams, startDate, endDate, filesScanned, matchCount: matches.length, truncated },
	});

	return ResponseUtil.Success({ matches, truncated, filesScanned });
};
