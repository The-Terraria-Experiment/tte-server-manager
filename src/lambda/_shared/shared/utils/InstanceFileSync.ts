import { DynamoDao } from "../aws/DynamoDB.js";
import { SsmDao } from "../aws/SSM.js";
import { CWLogger } from "../aws/CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";

/**
 * Bounded wait for the shutdown-time file sync. The SSM `aws s3 sync` must finish before the
 * instance actually powers off (SSM can't run once the box is stopping), but we never want a slow
 * or stuck sync to block a shutdown indefinitely. Incremental syncs after the first are fast; a
 * large first-time upload may exceed this window, in which case we log and proceed — EC2's graceful
 * (ACPI) shutdown still gives the in-flight upload a little extra runway before power-off.
 */
const SYNC_POLL_INTERVAL_MS = 2000;
const SYNC_MAX_POLLS = 45; // ~90s

const shellEscapeDq = (value: string): string => value.replace(/"/g, "\\\"");

/**
 * On instance shutdown, while the box is still online: pushes every file under the instance's
 * configured file roots up to the S3 filestore so they can be browsed and downloaded while the
 * instance is stopped. Uses `aws s3 sync` (additive — no `--delete`) so it only transfers changed
 * files and never removes objects that were deleted locally.
 *
 * The S3 layout mirrors what the download/read handlers expect: `{instanceId}/{rootPath}/…`, keyed
 * off the instance's `validRoots`. Awaits completion with a bounded timeout and never throws — a
 * slow or failed run is logged and swallowed so the caller's shutdown is never blocked or failed.
 *
 * Requires the S3_FILESTORE_NAME, BASE_ROOT and INSTANCE_TABLE_NAME env vars on the calling Lambda;
 * if any is missing the sync is logged and skipped rather than throwing.
 */
export async function syncInstanceFilesToS3(instanceId: string): Promise<void> {
	const bucket = process.env.S3_FILESTORE_NAME;
	const baseRoot = process.env.BASE_ROOT;
	const tableName = process.env.INSTANCE_TABLE_NAME;

	if (!bucket || !baseRoot || !tableName) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "instance-file-sync",
			error: "Missing env (S3_FILESTORE_NAME/BASE_ROOT/INSTANCE_TABLE_NAME), skipping instance file sync",
			details: { instanceId, hasBucket: !!bucket, hasBaseRoot: !!baseRoot, hasTable: !!tableName },
		});
		return;
	}

	let validRoots: Record<string, string> = {};
	try {
		const db = new DynamoDao();
		const instanceData = await db.GetItem(tableName, `inst#${instanceId}`);
		validRoots = (instanceData?.validRoots || {}) as Record<string, string>;
	} catch (error) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "instance-file-sync",
			error: error instanceof Error ? error.message : String(error),
			details: { instanceId, stage: "read-instance-data" },
		});
		return;
	}

	// Multiple root nicknames can map to the same path; dedupe so we sync each path once.
	const rootPaths = Array.from(
		new Set(Object.values(validRoots).filter((path) => typeof path === "string" && path.startsWith("/"))),
	);
	if (rootPaths.length === 0) {
		return;
	}

	const escapedBucket = shellEscapeDq(bucket);
	const commands: string[] = [
		"#!/bin/bash",
		"set -e",
		"",
		`echo "Syncing instance files to S3 (${rootPaths.length} root(s))"`,
		"",
	];

	for (const rootPath of rootPaths) {
		const localPath = `${baseRoot}${rootPath}`;
		// Mirror the key layout the read/download handlers build: `{instanceId}/{rootPath.slice(1)}/…`.
		const keyPrefix = `${instanceId}/${rootPath.slice(1)}`;
		const escapedLocalPath = shellEscapeDq(localPath);
		const s3Uri = `s3://${escapedBucket}/${shellEscapeDq(keyPrefix)}/`;
		commands.push(`if [ -d "${escapedLocalPath}" ]; then`);
		commands.push(
			`  runuser -u ubuntu -- /bin/bash -lc "aws s3 sync \\"${escapedLocalPath}\\" \\"${s3Uri}\\" --only-show-errors"`,
		);
		commands.push(`  echo "Synced: ${shellEscapeDq(keyPrefix)}"`);
		commands.push("else");
		commands.push(`  echo "Missing local root, skipping: ${escapedLocalPath}"`);
		commands.push("fi");
		commands.push("");
	}

	commands.push(`echo "Instance file sync complete"`);

	try {
		const SSM = new SsmDao();
		const { commandId } = await SSM.ExecuteCommand(instanceId, commands);
		await SSM.PollForCommandCompletion(commandId, instanceId, SYNC_POLL_INTERVAL_MS, SYNC_MAX_POLLS);
	} catch (error) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "instance-file-sync",
			error: error instanceof Error ? error.message : String(error),
			details: { instanceId, rootPaths },
		});
	}
}
