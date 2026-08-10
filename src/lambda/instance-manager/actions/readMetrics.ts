import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { S3Dao } from "../shared/aws/S3.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import {
	DEFAULT_METRICS_RANGE_SEC,
	MAX_METRICS_RANGE_SEC,
	METRICS_FETCH_CONCURRENCY,
	METRICS_POINT_BOUNDS,
	METRICS_READ_BUDGET_MS,
	aggregateMetricSamples,
	enumerateMetricsHourKeys,
	parseMetricsJsonl,
	type MetricSample,
} from "../shared/utils/instance/InstanceMetricsData.js";

const S3 = new S3Dao();

/** Parses an optional epoch-seconds query parameter. Returns null when absent, NaN when malformed. */
function parseEpochParam(raw: string | undefined): number | null {
	if (raw === undefined || raw === "") return null;
	const value = Number(raw);
	if (!Number.isFinite(value)) return Number.NaN;
	return Math.floor(value);
}

/**
 * Serves the collected CPU/memory samples for a time window.
 *
 * Reads only from S3 — never from the instance. The samples in the bucket are
 * whatever the collector has uploaded, so this costs the box nothing and works
 * identically against an instance that is currently stopped. The flip side is
 * that recent data lags by up to one upload interval (and indefinitely under
 * `uploadMode: manual`, until someone triggers one), which is why the response
 * reports `lastSampleAt` rather than letting the graph's right-hand edge imply
 * it is current.
 */
export const readMetrics = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const startedAt = Date.now();

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const bucket = process.env.S3_LOGS_BUCKET_NAME;
	if (!bucket) {
		return ResponseUtil.Error("Metrics bucket not configured", 500, "MISSING_CONFIG");
	}

	const query = event.queryStringParameters || {};

	const requestedEnd = parseEpochParam(query.end);
	const requestedStart = parseEpochParam(query.start);
	if (Number.isNaN(requestedEnd) || Number.isNaN(requestedStart)) {
		return ResponseUtil.ValidationError("start/end must be epoch seconds");
	}

	const nowSec = Math.floor(Date.now() / 1000);
	const endSec = requestedEnd ?? nowSec;
	const startSec = requestedStart ?? endSec - DEFAULT_METRICS_RANGE_SEC;

	if (startSec >= endSec) {
		return ResponseUtil.ValidationError("start must be earlier than end");
	}
	if (endSec - startSec > MAX_METRICS_RANGE_SEC) {
		return ResponseUtil.ValidationError(
			`Time range cannot exceed ${MAX_METRICS_RANGE_SEC / (24 * 3600)} days`,
		);
	}

	const requestedPoints = query.maxPoints === undefined ? METRICS_POINT_BOUNDS.default : Number(query.maxPoints);
	if (!Number.isFinite(requestedPoints)) {
		return ResponseUtil.ValidationError("maxPoints must be a number");
	}
	const maxPoints = Math.min(
		METRICS_POINT_BOUNDS.max,
		Math.max(METRICS_POINT_BOUNDS.min, Math.floor(requestedPoints)),
	);

	// Newest hour first, so running out of budget costs the oldest history rather
	// than the most recent — see enumerateMetricsHourKeys.
	const keys = enumerateMetricsHourKeys(instanceId, startSec, endSec);

	const samples: MetricSample[] = [];
	let filesFound = 0;
	let filesRead = 0;
	let truncated = false;

	for (let i = 0; i < keys.length; i += METRICS_FETCH_CONCURRENCY) {
		if (Date.now() - startedAt > METRICS_READ_BUDGET_MS) {
			truncated = true;
			break;
		}

		const batch = keys.slice(i, i + METRICS_FETCH_CONCURRENCY);
		const contents = await Promise.all(batch.map((key) => S3.GetObject(bucket, key)));
		filesRead += batch.length;

		for (const content of contents) {
			// `false` is a missing key, which is the ordinary state for any hour the
			// instance was stopped or the collector was off — not an error.
			if (content === false || content === undefined) continue;
			filesFound++;
			samples.push(...parseMetricsJsonl(content, startSec, endSec));
		}
	}

	const { points, bucketSec } = aggregateMetricSamples(samples, startSec, endSec, maxPoints);

	// The start of the oldest hour actually fetched. Keys run newest-first from the
	// hour containing `end`, so reading N of them covers back to N-1 hours before
	// it. On a truncated read the graph covers less than what was asked for, and
	// the difference has to be visible or the UI would present a shortened window
	// as the whole answer.
	const newestHourStart = Math.floor(endSec / 3600) * 3600;
	const coveredStart = truncated && filesRead > 0
		? Math.max(startSec, newestHourStart - (filesRead - 1) * 3600)
		: startSec;

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-metrics",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: {
			instanceId,
			startSec,
			endSec,
			maxPoints,
			bucketSec,
			hoursRequested: keys.length,
			filesRead,
			filesFound,
			sampleCount: samples.length,
			pointCount: points.length,
			truncated,
			elapsedMs: Date.now() - startedAt,
		},
	});

	return ResponseUtil.Success({
		instanceId,
		start: startSec,
		end: endSec,
		coveredStart,
		bucketSec,
		truncated,
		sampleCount: samples.length,
		filesFound,
		lastSampleAt: points.length > 0 ? points[points.length - 1]!.t : null,
		points,
	});
};
