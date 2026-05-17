import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { S3Dao } from "../shared/aws/S3.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";

const S3 = new S3Dao();

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
	const filesToUpload = s3Keys.map((s3Key) => {
		const relativePath = s3Key.startsWith(prefix) ? s3Key.slice(prefix.length) : s3Key;
		return {
			localPath: `${resolvedBasePath}/${relativePath}`,
			destinationKey: s3Key,
		};
	});

	const uploadResult = filesToUpload.length
		? await S3.SyncInstanceFilesToS3({
				instanceId,
				bucketName: s3Bucket,
				files: filesToUpload,
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

	try {
		const baseLocalPath = process.env.BASE_ROOT;
		const bucket = process.env.S3_FILESTORE_NAME;
		if (!bucket) {
			throw new Error("S3_FILESTORE_NAME env var not set");
		}

		const result = await syncFilesToInstance(instanceId, bucket, baseLocalPath);

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "file-sync",
			status: "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: {
				commandId: result.commandId,
				uploadCommandId: result.uploadCommandId,
				downloadCommandId: result.downloadCommandId,
				filesProcessed: result.filesProcessed,
			},
		});

		return ResponseUtil.Success({
			message: "File sync initiated successfully",
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
