import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { S3Dao, MISSING_LOCAL_FILE_MARKER } from "../shared/aws/S3.js";
import { SsmDao, isInstanceNotReadyForSsm } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { Assert } from "../shared/utils/core/Assert.js";

type DownloadFileBody = {
	pathRoot?: string;
	path?: string;
	fileName?: string;
};

const DB = new DynamoDao();
const S3 = new S3Dao();
const SSM = new SsmDao();
const EC2 = new Ec2Dao();

export const downloadFile = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	const bucketName = process.env.S3_FILESTORE_NAME;
	const baseRoot = process.env.BASE_ROOT;

	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}
	if (!bucketName) {
		return ResponseUtil.ValidationError("S3 bucket not configured");
	}

	Assert.IsTruthyString(baseRoot, "Base Root env var not set");

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const instanceData = await DB.GetItem(process.env.INSTANCE_TABLE_NAME as string, `inst#${instanceId}`);
	const allowedPaths = new Set(Object.values(instanceData?.validRoots || {}));

	let body: DownloadFileBody;
	try {
		body = JSON.parse(event.body || "{}") as DownloadFileBody;
	} catch {
		return ResponseUtil.ValidationError("Request body must be valid JSON");
	}

	const { pathRoot, path, fileName } = body;
	if (!pathRoot) {
		return ResponseUtil.ValidationError("pathRoot parameter is required");
	}
	if (!fileName) {
		return ResponseUtil.ValidationError("fileName parameter is required");
	}

	if (!allowedPaths.has(pathRoot)) {
		return ResponseUtil.ValidationError("Invalid pathRoot");
	}

	try {
		const pathComponents = [instanceId, pathRoot.slice(1)];
		if (path) {
			pathComponents.push(path);
		}
		pathComponents.push(fileName);
		const s3Key = pathComponents.join("/");

		const localPathComponents = [`${baseRoot}${pathRoot}`];
		if (path) {
			localPathComponents.push(path);
		}
		localPathComponents.push(fileName);
		const localFilePath = localPathComponents.join("/");

		// Instance files are synced up to S3 on shutdown, so when the box is offline we can serve the
		// already-synced object directly instead of doing a live SSM re-sync (which requires SSM, and
		// thus a running instance). While online we still re-sync so downloads reflect any edits made
		// since the last shutdown.
		const { state } = await EC2.GetInstanceStatus(instanceId);
		const online = state === InstanceState.RUNNING;

		let commandId: string | undefined;
		if (online) {
			let syncResult;
			try {
				const syncCommand = await S3.SyncInstanceFileToS3(instanceId, localFilePath, bucketName, s3Key);
				commandId = syncCommand.commandId;
				syncResult = await SSM.PollForCommandCompletion(commandId, instanceId);
			} catch (error) {
				// EC2 reports RUNNING before the SSM agent has registered (the boot warmup window), so a
				// download attempted right after start fails to reach SSM. Surface a clear "still starting,
				// retry shortly" response rather than a generic 500 — we can't safely serve the last-synced
				// S3 copy here because a running server's live world isn't uploaded until shutdown.
				if (isInstanceNotReadyForSsm(error)) {
					await CWLogger.Action(FUNC_NAMES.INST_MGR, {
						userId: Parsers.GetUserSub(event),
						action: "download-file",
						status: "error",
						resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
						details: { pathRoot, path, fileName, s3Key, reason: "ssm-not-ready", state },
					});

					return ResponseUtil.Error(
						"The instance is still starting up. Please wait a moment and try again.",
						409,
						"SSM_NOT_READY",
					);
				}
				throw error;
			}

			// The sync succeeds even when the source file is absent (the script skips it), which would
			// leave a stale prior object at s3Key. Treat a skip as a hard failure so we never hand back
			// an out-of-date download URL.
			if (syncResult.stdout.includes(MISSING_LOCAL_FILE_MARKER)) {
				await CWLogger.Action(FUNC_NAMES.INST_MGR, {
					userId: Parsers.GetUserSub(event),
					action: "download-file",
					status: "error",
					resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
					details: { pathRoot, path, fileName, s3Key, localFilePath, commandId, reason: "source-file-missing" },
				});

				return ResponseUtil.NotFoundError("File");
			}
		} else {
			// Offline: the object must already exist in S3 from a prior sync, otherwise there's
			// nothing to download and we can't reach the instance to fetch it.
			const objects = await S3.ListObjects(bucketName, s3Key);
			if (!objects.some((obj) => obj.key === s3Key)) {
				await CWLogger.Action(FUNC_NAMES.INST_MGR, {
					userId: Parsers.GetUserSub(event),
					action: "download-file",
					status: "error",
					resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
					details: { pathRoot, path, fileName, s3Key, reason: "not-synced-offline", state },
				});

				return ResponseUtil.NotFoundError("File");
			}
		}

		const downloadUrl = await S3.GetSignedDownloadUrl(bucketName, s3Key, 3600, fileName);

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "download-file",
			status: "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { pathRoot, path, fileName, s3Key, online, commandId },
		});

		return ResponseUtil.Success({ downloadUrl, fileName });
	} catch (error) {
		console.error("Download file error:", error);
		throw error;
	}
};
