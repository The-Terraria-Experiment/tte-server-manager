import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { S3Dao } from "../shared/aws/S3.js";
import { SsmDao, isSsmPollTimeout } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import { pollsUntilDeadline } from "../shared/utils/jobs/SyncBudget.js";

const S3 = new S3Dao();
const SSM = new SsmDao();

/**
 * Wait budget for the two SSM legs, sized against **API Gateway's 29s integration timeout** rather
 * than the lambda's own 300s — the same ceiling every other synchronous SSM action here works to.
 * ~18s of polling leaves room for cold start, both SendCommands, and the response.
 */
const SYNC_POLL_BUDGET_MS = 18000;
const SYNC_POLL_INTERVAL_MS = 1500;

export const syncFilesToInstance = async (
	instanceId: string,
	s3Bucket: string,
	baseLocalPath?: string,
): Promise<{
	commandId: string;
	filesProcessed: number;
	uploadCommandId?: string;
	downloadCommandId?: string;
}> => {
	if (!instanceId) {
		throw new Error("instanceId is required");
	}
	if (!s3Bucket) {
		throw new Error("s3Bucket is required");
	}

	const s3Objects = await S3.ListObjects(s3Bucket, `${instanceId}/`);
	if (s3Objects.length === 0) {
		throw new Error(`No files found in S3 for instance ${instanceId}`);
	}

	const resolvedBasePath = baseLocalPath ?? "/opt/terraria";
	const prefix = `${instanceId}/`;
	const s3Keys = s3Objects.map((obj) => obj.key).filter((key) => key && !key.endsWith("/"));
	const relativePaths = s3Keys.map((s3Key) => (s3Key.startsWith(prefix) ? s3Key.slice(prefix.length) : s3Key));

	const uploadResult = relativePaths.length
		? await S3.SyncTrackedFilesToS3({
				instanceId,
				bucketName: s3Bucket,
				baseRoot: resolvedBasePath,
				relativePaths,
			})
		: null;

	const downloadResult = await S3.SyncS3ToInstance({
		instanceId,
		bucketName: s3Bucket,
		sourceKey: `${instanceId}/`,
		localPath: resolvedBasePath,
		isFolder: true,
		overwriteExisting: false,
	});

	const commandId = downloadResult.commandId || uploadResult?.commandId || "";
	return {
		commandId,
		filesProcessed: s3Keys.length,
		uploadCommandId: uploadResult?.commandId || "[skipped]",
		downloadCommandId: downloadResult.commandId,
	};
};

export const fileSync = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const blocked = await blockIfShutdownInProgress(instanceId);
	if (blocked) return blocked;

	try {
		const baseLocalPath = process.env.BASE_ROOT;
		const bucket = process.env.S3_FILESTORE_NAME;
		if (!bucket) {
			throw new Error("S3_FILESTORE_NAME env var not set");
		}

		const result = await syncFilesToInstance(instanceId, bucket, baseLocalPath);

		// The commands are watched to completion rather than fire-and-forgotten. Returning as soon as
		// SendCommand accepted them meant the response said "sync complete" whatever happened next: a
		// download leg that failed outright still reported success, and the only record of it was an
		// SSM invocation nobody had a reason to open. That is how a run that copied nothing at all
		// looked identical to a working one.
		const deadline = Date.now() + SYNC_POLL_BUDGET_MS;
		const awaited: string[] = [result.downloadCommandId, result.uploadCommandId].filter(
			(id): id is string => !!id && id !== "[skipped]",
		);

		let stillRunning = false;
		for (const commandId of awaited) {
			const maxPolls = pollsUntilDeadline(deadline, SYNC_POLL_INTERVAL_MS);
			if (maxPolls === 0) {
				stillRunning = true;
				break;
			}
			try {
				await SSM.PollForCommandCompletion(commandId, instanceId, SYNC_POLL_INTERVAL_MS, maxPolls);
			} catch (error) {
				// Out of budget is not a failure — the command keeps running on the box and will finish.
				// Anything else is the command itself reporting a non-zero exit, which the caller needs.
				if (isSsmPollTimeout(error)) {
					stillRunning = true;
					continue;
				}
				const message = error instanceof Error ? error.message : String(error);
				await CWLogger.Error(FUNC_NAMES.INST_MGR, {
					userId: Parsers.GetUserSub(event),
					action: "file-sync",
					error: message,
					details: { instanceId, commandId, filesProcessed: result.filesProcessed },
				});
				return ResponseUtil.Error(`File sync failed on the instance: ${message}`, 502, "FILE_SYNC_FAILED");
			}
		}

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "file-sync",
			status: stillRunning ? "running" : "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: {
				commandId: result.commandId,
				uploadCommandId: result.uploadCommandId,
				downloadCommandId: result.downloadCommandId,
				filesProcessed: result.filesProcessed,
			},
		});

		return ResponseUtil.Success({
			message: stillRunning
				? "File sync is still running on the instance"
				: "File sync completed successfully",
			syncStatus: stillRunning ? "running" : "complete",
			commandId: result.commandId,
			uploadCommandId: result.uploadCommandId,
			downloadCommandId: result.downloadCommandId,
			filesProcessed: result.filesProcessed,
		});
	} catch (error) {
		console.error("File sync error:", error);
		throw error;
	}
};
