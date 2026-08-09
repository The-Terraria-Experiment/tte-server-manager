/**
 * Read side of the instance metrics pipeline.
 *
 * The collector (`src/instance-scripts/metrics/`) appends one JSON object per
 * sample to an hourly file and the uploader PUTs those files to the logs bucket
 * under `metrics/{instanceId}/YYYY/MM/DD/HH.jsonl`. This module turns that key
 * layout and those lines back into a plottable series.
 *
 * `InstanceMetrics.ts` is the *control* plane (is the collector on, how often
 * does it sample); this is the data plane. They share nothing but the S3 layout,
 * which is why they're separate files.
 */

/**
 * Mirrors `TTE_METRICS_PREFIX`'s default in `metrics/install.sh`. Nothing in
 * this repo ever passes a different one — `setup.sh` only supplies the bucket —
 * so this is a constant rather than an env var. A box installed with a custom
 * prefix would upload where nothing reads.
 */
export const METRICS_S3_PREFIX = "metrics";

const HOUR_SEC = 3600;

/** One line of an hourly `.jsonl` file, as written by `tte-metrics-collect.sh`. */
export type MetricSample = {
	/** Epoch seconds. Authoritative — the key's hour is only a coarse index. */
	t: number;
	/** CPU utilization percent over the interval since the previous sample. */
	cpu: number;
	/** Used memory as a percent of MemTotal. */
	mem: number;
	/** Used memory in MB, so the UI can label an absolute figure. */
	memMb: number;
};

/**
 * One aggregated point. Every graph on the page shares this one array — the
 * series are time-aligned by construction, so emitting a separate `t` per metric
 * would triple the payload to say the same thing.
 */
export type MetricPoint = {
	t: number;
	/**
	 * Line segment index. Bumped across a gap in the data (an instance that was
	 * stopped, or a collector that was off) so `Graph.vue` breaks the line there
	 * instead of drawing a straight edge across hours of absence.
	 */
	group: number;
	/** Mean CPU percent across the bucket. */
	cpu: number;
	/** Peak CPU percent in the bucket. Averaging alone hides exactly the spikes worth seeing. */
	cpuMax: number;
	mem: number;
	memMb: number;
};

/** Widest window a single request may ask for, in seconds. */
export const MAX_METRICS_RANGE_SEC = 14 * 24 * HOUR_SEC;

export const DEFAULT_METRICS_RANGE_SEC = 6 * HOUR_SEC;

export const METRICS_POINT_BOUNDS = {
	min: 50,
	max: 5000,
	default: 750,
} as const;

/**
 * How long the S3 fetch may run before the response is served with whatever it
 * has. Sized against **API Gateway's 29s integration timeout**, not the
 * lambda's own 300s: a read that polls past the gateway produces a 504 for the
 * browser while the invocation carries on and succeeds. 14 days is 336 objects,
 * and a cold client can be slower than that budget allows — a partial graph
 * flagged as such beats a 504.
 */
export const METRICS_READ_BUDGET_MS = 18000;

/** Objects fetched per `Promise.all` wave. */
export const METRICS_FETCH_CONCURRENCY = 16;

/**
 * Multiple of the observed sample cadence beyond which two consecutive points
 * are considered to have a gap between them rather than to be adjacent.
 */
const GAP_INTERVAL_MULTIPLE = 3;

/** Floor for the gap threshold, so a very fast cadence doesn't split on ordinary jitter. */
const MIN_GAP_SEC = 90;

const pad2 = (value: number): string => String(value).padStart(2, "0");

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * The S3 key for the hour containing `epochSec`.
 *
 * UTC, matching what the collector writes: `tte-metrics-collect.sh` pins `TZ=UTC`
 * before formatting the path precisely so this side can compute a key rather
 * than having to list the bucket. Samples are filtered on their own `t` field
 * regardless, so a box that somehow wrote local-time paths loses only the
 * shifted hours at the edges of the window, not correctness within it.
 */
export function buildMetricsHourKey(instanceId: string, epochSec: number): string {
	const date = new Date(epochSec * 1000);
	const path = [
		date.getUTCFullYear(),
		pad2(date.getUTCMonth() + 1),
		pad2(date.getUTCDate()),
		pad2(date.getUTCHours()),
	].join("/");

	return `${METRICS_S3_PREFIX}/${instanceId}/${path}.jsonl`;
}

/**
 * Every hourly key overlapping [startSec, endSec], **newest first**.
 *
 * The order is load-bearing: the caller fetches until it runs out of budget, so
 * a truncated read keeps the most recent history — which is the part anyone
 * looking at a graph came for — rather than the oldest.
 */
export function enumerateMetricsHourKeys(instanceId: string, startSec: number, endSec: number): string[] {
	const firstHour = Math.floor(startSec / HOUR_SEC) * HOUR_SEC;
	const lastHour = Math.floor(endSec / HOUR_SEC) * HOUR_SEC;

	const keys: string[] = [];
	for (let hour = lastHour; hour >= firstHour; hour -= HOUR_SEC) {
		keys.push(buildMetricsHourKey(instanceId, hour));
	}

	return keys;
}

const finiteNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Parses one hourly file, keeping only the samples inside the window.
 *
 * Unparseable lines are skipped rather than thrown on. The current hour's file
 * is uploaded while the collector is still appending to it, so a torn final line
 * is a normal thing to read, not a corruption to report.
 */
export function parseMetricsJsonl(text: string, startSec: number, endSec: number): MetricSample[] {
	const samples: MetricSample[] = [];

	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;

		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(trimmed) as Record<string, unknown>;
		} catch {
			continue;
		}

		const t = parsed.t;
		if (typeof t !== "number" || !Number.isFinite(t)) continue;
		if (t < startSec || t > endSec) continue;

		samples.push({
			t,
			cpu: finiteNumber(parsed.cpu),
			mem: finiteNumber(parsed.mem),
			memMb: finiteNumber(parsed.memMb),
		});
	}

	return samples;
}

/** Median of the deltas between consecutive timestamps, or 0 for fewer than two points. */
function medianInterval(sorted: MetricSample[]): number {
	if (sorted.length < 2) return 0;

	const deltas: number[] = [];
	for (let i = 1; i < sorted.length; i++) {
		deltas.push(sorted[i]!.t - sorted[i - 1]!.t);
	}
	deltas.sort((a, b) => a - b);

	return deltas[Math.floor(deltas.length / 2)] ?? 0;
}

/**
 * Collapses raw samples into at most `maxPoints` time buckets.
 *
 * A 15s cadence over 14 days is ~80k samples; handing that to a canvas that is
 * a thousand pixels wide is several megabytes of JSON to draw the same picture.
 * The bucket width is derived from the requested window, so the response size is
 * bounded by the window rather than by how the collector happens to be tuned.
 *
 * Empty buckets are omitted rather than emitted as zeroes: a stopped instance
 * produced no data, and plotting 0% CPU for it would be a claim about the box
 * that isn't true. Those omissions are what `group` then breaks the line on.
 */
export function aggregateMetricSamples(
	samples: MetricSample[],
	startSec: number,
	endSec: number,
	maxPoints: number,
): { points: MetricPoint[]; bucketSec: number } {
	const sorted = [...samples].sort((a, b) => a.t - b.t);
	const bucketSec = Math.max(1, Math.ceil((endSec - startSec) / maxPoints));

	if (sorted.length === 0) {
		return { points: [], bucketSec };
	}

	type Bucket = { tSum: number; cpuSum: number; cpuMax: number; memSum: number; memMbSum: number; count: number };
	const buckets = new Map<number, Bucket>();

	for (const sample of sorted) {
		const index = Math.floor((sample.t - startSec) / bucketSec);
		const bucket = buckets.get(index);
		if (bucket) {
			bucket.tSum += sample.t;
			bucket.cpuSum += sample.cpu;
			bucket.cpuMax = Math.max(bucket.cpuMax, sample.cpu);
			bucket.memSum += sample.mem;
			bucket.memMbSum += sample.memMb;
			bucket.count++;
		} else {
			buckets.set(index, {
				tSum: sample.t,
				cpuSum: sample.cpu,
				cpuMax: sample.cpu,
				memSum: sample.mem,
				memMbSum: sample.memMb,
				count: 1,
			});
		}
	}

	// Averaged rather than snapped to the bucket start, so a bucket holding a
	// single sample reports that sample's real time. At the natural resolution
	// (bucketSec below the sample interval) that makes this a pass-through.
	type AggregatedSample = MetricSample & { cpuMax: number };
	const aggregated: AggregatedSample[] = [...buckets.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, bucket]) => ({
			t: Math.round(bucket.tSum / bucket.count),
			cpu: bucket.cpuSum / bucket.count,
			mem: bucket.memSum / bucket.count,
			memMb: bucket.memMbSum / bucket.count,
			cpuMax: bucket.cpuMax,
		}));

	// Derived from what was actually collected rather than from the stored
	// config, which describes the collector *now* and says nothing about how it
	// was tuned earlier in the window.
	const interval = medianInterval(aggregated);
	const gapSec = Math.max(MIN_GAP_SEC, GAP_INTERVAL_MULTIPLE * Math.max(interval, bucketSec));

	const points: MetricPoint[] = [];
	let group = 0;

	for (let i = 0; i < aggregated.length; i++) {
		const entry = aggregated[i]!;
		const previous = aggregated[i - 1];
		if (previous && entry.t - previous.t > gapSec) {
			group++;
		}

		points.push({
			t: entry.t,
			group,
			cpu: round1(entry.cpu),
			cpuMax: round1(entry.cpuMax),
			mem: round1(entry.mem),
			memMb: round1(entry.memMb),
		});
	}

	return { points, bucketSec };
}
