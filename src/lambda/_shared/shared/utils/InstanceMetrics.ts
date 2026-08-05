/**
 * Control-plane helpers for the on-instance metrics collector
 * (`src/instance-scripts/metrics/`).
 *
 * Everything here funnels through the single `/usr/local/bin/tte-metrics-ctl`
 * entry point installed on the box, so the shell logic for "what does enabling
 * metrics actually do" lives in one place in the repo rather than being
 * assembled from command fragments here. This module only builds the argv and
 * parses the JSON that comes back.
 */

import type { SsmCommandResult } from "../aws/SSM.js";

export const METRICS_CTL = "/usr/local/bin/tte-metrics-ctl";

export type MetricsUploadMode = "timer" | "manual";

/** Desired state, as persisted on the `inst#<id>` row and edited from the UI. */
export type MetricsConfig = {
	enabled: boolean;
	uploadMode: MetricsUploadMode;
	collectSec: number;
	/** Only meaningful in `timer` mode, but retained across a switch to `manual` so a tuned interval survives the round trip. */
	uploadSec: number;
	retainDays: number;
};

/** Live state as reported by `tte-metrics-ctl status`. */
export type MetricsStatus = MetricsConfig & {
	/** False when the units were never installed at all, as opposed to installed-and-off. */
	installed: boolean;
	/** The collect timer is currently running, not merely enabled for next boot. */
	active: boolean;
	flushEnabled: boolean;
	/** Buffer files not yet pruned. In manual mode this is the visible backlog. */
	pendingFiles: number;
	/** Epoch seconds of the last upload run, or 0 if it has never run. */
	lastUploadAt: number;
};

/**
 * Mirrored by the *_MIN/*_MAX constants in `tte-metrics-ctl.sh`. Both sides
 * enforce them: this side to give the UI a real validation error, the script
 * side so a hand-run command can't install a pathological timer.
 */
export const METRICS_BOUNDS = {
	collectSec: { min: 15, max: 3600 },
	uploadSec: { min: 60, max: 3600 },
	retainDays: { min: 1, max: 30 },
} as const;

/**
 * SSM poll budget for every metrics action, sized to fit inside **API Gateway's
 * 29-second integration timeout** rather than the lambda's own timeout.
 *
 * All three metrics endpoints are synchronous request/response behind the
 * gateway. A lambda that polls longer than the gateway will wait produces a 504
 * for the browser while the invocation keeps running and succeeds — so the work
 * happens, the UI reports failure, and the obvious response (retry) re-runs it.
 * `SsmDao`'s own default of 30 × 1000ms is already past that line, which is why
 * these actions pass an explicit budget instead of taking the default.
 *
 * 20s of polling leaves ~9s of headroom for the cold start, `SendCommand`, and
 * marshalling the response, none of which this budget controls. Overrunning it
 * is not data loss: the command finishes on the box regardless, and callers use
 * `isSsmPollTimeout` to say so rather than reporting a failure.
 */
export const METRICS_SSM_POLL = {
	intervalMs: 1000,
	maxPolls: 20,
} as const;

export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
	enabled: true,
	uploadMode: "timer",
	collectSec: 60,
	uploadSec: 300,
	retainDays: 2,
};

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

/**
 * Validates a config coming off the wire. Returns the errors rather than
 * throwing so the caller can hand the whole list back in one 400.
 */
export function validateMetricsConfig(input: unknown): { valid: boolean; errors: string[]; config?: MetricsConfig } {
	const errors: string[] = [];

	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return { valid: false, errors: ["config must be an object"] };
	}

	const raw = input as Record<string, unknown>;

	if (typeof raw.enabled !== "boolean") {
		errors.push("enabled must be a boolean");
	}
	if (raw.uploadMode !== "timer" && raw.uploadMode !== "manual") {
		errors.push("uploadMode must be 'timer' or 'manual'");
	}

	for (const key of ["collectSec", "uploadSec", "retainDays"] as const) {
		const bounds = METRICS_BOUNDS[key];
		const value = raw[key];
		if (!isInt(value)) {
			errors.push(`${key} must be a whole number`);
		} else if (value < bounds.min || value > bounds.max) {
			errors.push(`${key} must be between ${bounds.min} and ${bounds.max}`);
		}
	}

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	return {
		valid: true,
		errors: [],
		config: {
			enabled: raw.enabled as boolean,
			uploadMode: raw.uploadMode as MetricsUploadMode,
			collectSec: raw.collectSec as number,
			uploadSec: raw.uploadSec as number,
			retainDays: raw.retainDays as number,
		},
	};
}

/**
 * Builds the `apply` command. Every value is validated and numeric or a fixed
 * enum by the time it lands here, so nothing user-controlled reaches the shell
 * as free text.
 */
export function buildApplyCommand(config: MetricsConfig): string[] {
	return [
		`${METRICS_CTL} apply` +
			` --enabled=${config.enabled ? "true" : "false"}` +
			` --upload-mode=${config.uploadMode}` +
			` --collect=${config.collectSec}` +
			` --upload=${config.uploadSec}` +
			` --retain=${config.retainDays}`,
	];
}

export function buildStatusCommand(): string[] {
	return [`${METRICS_CTL} status`];
}

/**
 * Builds the `upload` command.
 *
 * `selftest` swaps the real buffer upload for a single tiny probe object. The
 * uploader signs its own SigV4 requests rather than shelling out to the AWS
 * CLI, so a signing or IAM fault would otherwise only show up as a 403 on a
 * timer that nobody is watching — this makes it checkable on demand, and it
 * touches neither the buffer nor the upload stamp.
 */
export function buildUploadCommand(selftest = false): string[] {
	return [`${METRICS_CTL} upload${selftest ? " --selftest" : ""}`];
}

/**
 * Turns the uploader's stderr from a failed `--selftest` into one readable line.
 *
 * The three plausible causes are indistinguishable from the HTTP status alone
 * but each carries a distinct S3 error code, and telling them apart is the
 * entire value of the probe:
 *   - `SignatureDoesNotMatch` — a bug in the SigV4 signing
 *   - `AccessDenied`          — the instance role is missing s3:PutObject
 *   - `RequestTimeTooSkewed`  — clock drift over 15 minutes (chrony not running)
 *
 * Falls back to a trimmed excerpt when nothing recognisable is in there, since a
 * raw fragment still beats "Internal Server Error".
 */
export function describeSelftestFailure(raw: string): string {
	const text = (raw || "").trim();
	if (!text) return "The selftest failed without reporting a reason.";

	const s3Code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
	const httpCode = /\(HTTP (\d{3})\)/.exec(text)?.[1];

	const hints: Record<string, string> = {
		SignatureDoesNotMatch: "the uploader's request signing is wrong",
		AccessDenied: "the instance role is missing s3:PutObject on the metrics prefix",
		RequestTimeTooSkewed: "the instance clock has drifted more than 15 minutes",
		InvalidAccessKeyId: "the instance credentials were rejected",
		NoSuchBucket: "the configured logs bucket does not exist",
	};

	if (s3Code) {
		const hint = hints[s3Code];
		const status = httpCode ? ` (HTTP ${httpCode})` : "";
		return hint ? `S3 rejected the probe with ${s3Code}${status} — ${hint}.` : `S3 rejected the probe with ${s3Code}${status}.`;
	}

	return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

/**
 * Parses `tte-metrics-ctl` stdout. Both `apply` and `upload` echo a status line
 * as their last output, so a single parser covers all three commands and the
 * caller always gets back the state the box is actually in afterwards.
 *
 * Returns null rather than throwing when the box has no collector installed --
 * an old or hand-built instance is a state the UI should render, not an error.
 */
export function parseMetricsStatus(result: SsmCommandResult): MetricsStatus | null {
	const lines = (result.stdout || "")
		.split("\n")
		.map(line => line.trim())
		.filter(line => line.startsWith("{"));

	const last = lines[lines.length - 1];
	if (!last) return null;

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(last) as Record<string, unknown>;
	} catch {
		return null;
	}

	if (typeof parsed.installed !== "boolean") return null;

	return {
		installed: parsed.installed,
		enabled: parsed.enabled === true,
		active: parsed.active === true,
		flushEnabled: parsed.flushEnabled === true,
		uploadMode: parsed.uploadMode === "manual" ? "manual" : "timer",
		collectSec: isInt(parsed.collectSec) ? parsed.collectSec : DEFAULT_METRICS_CONFIG.collectSec,
		uploadSec: isInt(parsed.uploadSec) ? parsed.uploadSec : DEFAULT_METRICS_CONFIG.uploadSec,
		retainDays: isInt(parsed.retainDays) ? parsed.retainDays : DEFAULT_METRICS_CONFIG.retainDays,
		pendingFiles: isInt(parsed.pendingFiles) ? parsed.pendingFiles : 0,
		lastUploadAt: isInt(parsed.lastUploadAt) ? parsed.lastUploadAt : 0,
	};
}

/**
 * True when the stored desired state and the box's live state disagree. Drift is
 * expected rather than exceptional -- a config written while the instance was
 * stopped hasn't been applied yet -- so the UI surfaces it instead of the API
 * treating it as a failure.
 */
export function hasMetricsDrift(desired: MetricsConfig, actual: MetricsStatus): boolean {
	return (
		desired.enabled !== actual.enabled ||
		desired.uploadMode !== actual.uploadMode ||
		desired.collectSec !== actual.collectSec ||
		desired.uploadSec !== actual.uploadSec ||
		desired.retainDays !== actual.retainDays
	);
}

/** Coerces a stored Dynamo attribute into a config, falling back per-field. */
export function toMetricsConfig(stored: unknown): MetricsConfig {
	if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
		return { ...DEFAULT_METRICS_CONFIG };
	}

	const raw = stored as Record<string, unknown>;
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_METRICS_CONFIG.enabled,
		uploadMode: raw.uploadMode === "manual" ? "manual" : DEFAULT_METRICS_CONFIG.uploadMode,
		collectSec: isInt(raw.collectSec) ? raw.collectSec : DEFAULT_METRICS_CONFIG.collectSec,
		uploadSec: isInt(raw.uploadSec) ? raw.uploadSec : DEFAULT_METRICS_CONFIG.uploadSec,
		retainDays: isInt(raw.retainDays) ? raw.retainDays : DEFAULT_METRICS_CONFIG.retainDays,
	};
}
