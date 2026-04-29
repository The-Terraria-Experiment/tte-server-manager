import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { S3Dao } from "../shared/aws/S3.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Parsers } from "../shared/utils/Parsers.js";

type UploadFilesBody = {
	pathRoot?: string;
	path?: string;
	fileName?: string;
};

const DB = new DynamoDao();
const S3 = new S3Dao();

export const uploadFiles = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	const bucketName = process.env.S3_FILESTORE_NAME;

	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	if (!bucketName) {
		return ResponseUtil.ValidationError("S3 bucket not configured");
	}

	const instanceData = await DB.GetItem(process.env.INSTANCE_TABLE_NAME as string, `inst#${instanceId}`);
	const allowedPaths = new Set(Object.values(instanceData?.validRoots || {}));

	let body: UploadFilesBody;
	try {
		body = JSON.parse(event.body || "{}") as UploadFilesBody;
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

		const uploadUrl = await S3.GetSignedUploadUrl(bucketName, s3Key, 3600);

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "upload-files",
			status: "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { path, fileName, pathRoot, instanceId, s3Key },
		});

		return ResponseUtil.Success({
			message: "Pre-signed upload URL generated",
			uploadUrl,
			s3Key,
			instanceId,
			pathRoot,
			path,
			fileName,
			expiresIn: 3600,
		});
	} catch (error) {
		console.error("Error generating pre-signed URL:", error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return ResponseUtil.ValidationError(`Failed to generate upload URL: ${errorMessage}`);
	}
};
