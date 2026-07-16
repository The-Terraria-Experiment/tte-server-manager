import path from "path";
import { SsmDao } from "../aws/SSM.js";
import { CWLogger } from "../aws/CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";
import { getRecentDates } from "./LogDateRanges.js";
import { pollsUntilDeadline } from "./SyncBudget.js";

/** Local TShock log files older than this many days are pruned from the instance on shutdown. */
const LOCAL_RETENTION_DAYS = 30;

/**
 * Archiving two small log files is quick, so this keeps its own modest ceiling. It also never claims
 * more than {@link LOG_SYNC_BUDGET_SHARE} of the shared shutdown budget: the instance file sync runs
 * after this one and carries the world saves, so a slow archive must not leave it nothing. Whatever
 * this doesn't use rolls over to it.
 */
const LOG_SYNC_POLL_INTERVAL_MS = 1000;
const LOG_SYNC_MAX_POLLS = 8;
const LOG_SYNC_BUDGET_SHARE = 0.5;

/**
 * Helpers for the TShock/TerrariaServer process's own stdout+stderr stream — NOT a generic
 * "console logs" facility. Instances run other headless processes (SSM agent, systemd units,
 * etc.) whose logs, if ever archived the same way, belong under their own prefix/helpers rather
 * than being lumped in here.
 */

export type TShockLogStream = "out" | "err";

export function buildTShockLogS3Key(instanceId: string, stream: TShockLogStream, date: string): string {
	return `tshock-console/${instanceId}/${stream}/${date}.log`;
}

/** Prefix under which all of an instance's TShock console log files live. */
export function tshockLogPrefix(instanceId: string): string {
	return `tshock-console/${instanceId}/`;
}

/**
 * Parses an S3 key produced by buildTShockLogS3Key back into its stream + date, or null if the
 * key doesn't match the expected `tshock-console/{instanceId}/{stream}/{YYYY-MM-DD}.log` shape.
 */
export function parseTShockLogKey(instanceId: string, key: string): { stream: TShockLogStream; date: string } | null {
	const prefix = tshockLogPrefix(instanceId);
	if (!key.startsWith(prefix)) return null;

	const remainder = key.slice(prefix.length);
	const match = remainder.match(/^(out|err)\/(\d{4}-\d{2}-\d{2})\.log$/);
	if (!match) return null;

	return { stream: match[1] as TShockLogStream, date: match[2]! };
}

function getStreamLocalRoot(stream: TShockLogStream): string | undefined {
	const raw = stream === "out" ? process.env.TSHOCK_OUT_LOGS : process.env.TSHOCK_ERR_LOGS;
	const trimmed = (raw || "").trim().replace(/\/$/, "");
	return trimmed || undefined;
}

const shellEscapeDq = (value: string): string => value.replace(/"/g, "\\\"");

/**
 * On instance shutdown, in a single SSM command while the box is still online: uploads today +
 * yesterday's TShock stdout/stderr log files to S3, then prunes local log files older than the
 * retention window. Awaits completion with a short bounded timeout and never throws — a slow or
 * failed run is logged and swallowed so the caller's shutdown is never blocked or failed by it.
 *
 * Combining upload + prune into one command keeps it to a single round trip on the shutdown path;
 * the two concerns don't overlap (prune only touches files far older than what we upload).
 *
 * @param deadline Absolute epoch-ms to stop waiting, from {@link shutdownSyncDeadline}.
 */
export async function syncAndPruneTShockLogs(instanceId: string, deadline: number): Promise<void> {
	const bucket = process.env.S3_LOGS_BUCKET_NAME;
	if (!bucket) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "tshock-log-sync",
			error: "S3_LOGS_BUCKET_NAME env var not set, skipping TShock log sync",
			details: { instanceId },
		});
		return;
	}

	const dates = getRecentDates(1);
	const streams: TShockLogStream[] = ["out", "err"];
	const uploads: Array<{ localPath: string; s3Key: string }> = [];
	const pruneRoots: string[] = [];

	for (const stream of streams) {
		const root = getStreamLocalRoot(stream);
		if (!root) continue;
		pruneRoots.push(root);

		for (const date of dates) {
			uploads.push({
				localPath: path.posix.join(root, `${date}.log`),
				s3Key: buildTShockLogS3Key(instanceId, stream, date),
			});
		}
	}

	if (pruneRoots.length === 0) {
		return;
	}

	const escapedBucket = shellEscapeDq(bucket);
	const commands: string[] = [
		"#!/bin/bash",
		"set -e",
		"",
		`echo "Archiving TShock logs (${uploads.length} file(s))"`,
		"",
	];

	// Upload recent logs (skip any that don't exist locally).
	for (const { localPath, s3Key } of uploads) {
		const escapedLocalPath = shellEscapeDq(localPath);
		const escapedKey = shellEscapeDq(s3Key.replace(/^\/+/, ""));
		const s3Uri = `s3://${escapedBucket}/${escapedKey}`;
		commands.push(`if [ -f "${escapedLocalPath}" ]; then`);
		commands.push(`  runuser -u ubuntu -- /bin/bash -lc "aws s3 cp \\"${escapedLocalPath}\\" \\"${s3Uri}\\" --only-show-errors"`);
		commands.push(`  echo "Uploaded: ${escapedKey}"`);
		commands.push("fi");
	}

	// Prune stale local logs. Guarded so a missing dir or find error can't fail the shutdown.
	commands.push("");
	for (const root of pruneRoots) {
		const escapedRoot = shellEscapeDq(root);
		commands.push(`if [ -d "${escapedRoot}" ]; then find "${escapedRoot}" -name '*.log' -mtime +${LOCAL_RETENTION_DAYS} -delete 2>/dev/null || true; fi`);
	}
	commands.push(`echo "TShock log archive + prune complete"`);

	try {
		const SSM = new SsmDao();
		const { commandId } = await SSM.ExecuteCommand(instanceId, commands);

		const share = Math.floor(pollsUntilDeadline(deadline, LOG_SYNC_POLL_INTERVAL_MS) * LOG_SYNC_BUDGET_SHARE);
		const maxPolls = Math.min(LOG_SYNC_MAX_POLLS, share);
		if (maxPolls === 0) {
			// Out of budget: leave the archive in flight rather than delay the stop any further.
			return;
		}

		await SSM.PollForCommandCompletion(commandId, instanceId, LOG_SYNC_POLL_INTERVAL_MS, maxPolls);
	} catch (error) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "tshock-log-sync",
			error: error instanceof Error ? error.message : String(error),
			details: { instanceId },
		});
	}
}
