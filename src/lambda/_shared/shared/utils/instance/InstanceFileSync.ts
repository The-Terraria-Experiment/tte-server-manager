import { S3Dao } from "../../aws/S3.js";
import { SsmDao } from "../../aws/SSM.js";
import { CWLogger } from "../../aws/CloudWatch.js";
import { CW_LOG_GENERAL } from "../../constants.js";
import { pollsUntilDeadline } from "../jobs/SyncBudget.js";

/**
 * Bounded wait for the shutdown-time file sync. The SSM upload must finish before the instance
 * actually powers off (SSM can't run once the box is stopping), but we never want a slow or stuck
 * sync to block a shutdown indefinitely. The ceiling comes from the caller's `deadline` rather than a
 * fixed poll count, so the wait always ends while the invocation still has room to issue the stop.
 * If it runs out the upload is left in flight — EC2's graceful (ACPI) shutdown still gives it a
 * little extra runway before power-off.
 */
const SYNC_POLL_INTERVAL_MS = 2000;

const S3 = new S3Dao();
const SSM = new SsmDao();

/**
 * On instance shutdown, while the box is still online: refreshes the S3 filestore copies of the
 * files we already track for this instance so they can be browsed and downloaded while it's stopped.
 *
 * Only the files that already exist in S3 under `{instanceId}/` are considered — i.e. the ones we
 * intentionally put there (via upload / manual resync), NOT everything on disk. This mirrors the
 * upload leg of the manual file sync ({@link fileSync}) and keeps us from hoovering up untracked,
 * auto-generated instance files. Of those, only the ones whose bytes actually changed are uploaded;
 * a shutdown after a normal session typically means just the world that was played.
 *
 * Awaits completion until `deadline` and never throws — a slow or failed run is logged and swallowed
 * so the caller's shutdown is never blocked or failed. Requires the S3_FILESTORE_NAME and BASE_ROOT
 * env vars; if either is missing the sync is logged and skipped.
 *
 * @param deadline Absolute epoch-ms to stop waiting, from the shutdown worker's per-task budget (see ShutdownTasks).
 */
export async function syncInstanceFilesToS3(instanceId: string, deadline: number): Promise<void> {
	const bucket = process.env.S3_FILESTORE_NAME;
	const baseRoot = process.env.BASE_ROOT;

	if (!bucket || !baseRoot) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "instance-file-sync",
			error: "Missing env (S3_FILESTORE_NAME/BASE_ROOT), skipping instance file sync",
			details: { instanceId, hasBucket: !!bucket, hasBaseRoot: !!baseRoot },
		});
		return;
	}

	let relativePaths: string[];
	try {
		const prefix = `${instanceId}/`;
		const s3Objects = await S3.ListObjects(bucket, prefix);
		relativePaths = s3Objects
			.map((obj) => obj.key)
			.filter((key) => key && !key.endsWith("/"))
			.map((key) => (key.startsWith(prefix) ? key.slice(prefix.length) : key));
	} catch (error) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "instance-file-sync",
			error: error instanceof Error ? error.message : String(error),
			details: { instanceId, stage: "list-s3-objects" },
		});
		return;
	}

	if (relativePaths.length === 0) {
		// Nothing tracked in S3 yet — nothing to refresh.
		return;
	}

	try {
		const { commandId } = await S3.SyncTrackedFilesToS3({
			instanceId,
			bucketName: bucket,
			baseRoot,
			relativePaths,
		});

		const maxPolls = pollsUntilDeadline(deadline, SYNC_POLL_INTERVAL_MS);
		if (maxPolls === 0) {
			await CWLogger.Error(CW_LOG_GENERAL, {
				userId: null,
				action: "instance-file-sync",
				error: "No wait budget left; upload left in flight so the stop can proceed",
				details: { instanceId, commandId, fileCount: relativePaths.length },
			});
			return;
		}

		await SSM.PollForCommandCompletion(commandId, instanceId, SYNC_POLL_INTERVAL_MS, maxPolls);
	} catch (error) {
		await CWLogger.Error(CW_LOG_GENERAL, {
			userId: null,
			action: "instance-file-sync",
			error: error instanceof Error ? error.message : String(error),
			details: { instanceId, fileCount: relativePaths.length },
		});
	}
}
