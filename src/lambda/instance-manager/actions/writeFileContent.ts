import type { Context } from "aws-lambda";
import { posix } from "node:path";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { S3Dao } from "../shared/aws/S3.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { Assert } from "../shared/utils/Assert.js";

type WriteFileContentBody = {
	rootName?: string;
	relativePath?: string;
	content?: string;
};

const DB = new DynamoDao();
const S3 = new S3Dao();

const isSafeNickname = (nickname: string): boolean => {
	return typeof nickname === "string" && nickname.length > 0 && nickname.length <= 64 && /^[A-Za-z0-9_-]+$/.test(nickname);
};

const normalizeRelativePath = (input: string): string | null => {
	if (typeof input !== "string") return null;
	const trimmed = input.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("/")) return null;
	if (trimmed.endsWith("/")) return null;
	if (trimmed.includes("\\")) return null;
	if (/[\x00-\x1F]/.test(trimmed)) return null;

	const normalized = posix.normalize(trimmed);
	if (!normalized || normalized === "." || normalized === "..") return null;
	if (normalized.startsWith("/")) return null;
	if (normalized.startsWith("../") || normalized.includes("/..")) return null;
	if (normalized.endsWith("/")) return null;
	return normalized;
};

const getContentType = (relativePath: string): string => {
	const ext = posix.extname(relativePath).toLowerCase();
	if (ext === ".json") return "application/json";
	if (ext === ".yml" || ext === ".yaml") return "application/x-yaml";
	return "text/plain; charset=utf-8";
};

export const writeFileContent = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const bucketName = process.env.S3_FILESTORE_NAME;
	if (!bucketName) {
		return ResponseUtil.ValidationError("S3 bucket not configured");
	}

	const baseRoot = process.env.BASE_ROOT;
	Assert.IsTruthyString(baseRoot, "Base Root env var not set");

	const body = (event.parsedBody || {}) as WriteFileContentBody;
	const rootName = typeof body.rootName === "string" ? body.rootName.trim() : "";
	if (!rootName) {
		return ResponseUtil.ValidationError("rootName parameter is required");
	}
	if (!isSafeNickname(rootName)) {
		return ResponseUtil.ValidationError("Invalid rootName");
	}

	const relativePath = normalizeRelativePath(body.relativePath ?? "");
	if (!relativePath) {
		return ResponseUtil.ValidationError("relativePath parameter is required");
	}

	if (body.content === undefined || body.content === null) {
		return ResponseUtil.ValidationError("content parameter is required");
	}
	if (typeof body.content !== "string") {
		return ResponseUtil.ValidationError("content must be a string");
	}

	const instanceData = await DB.GetItem(process.env.INSTANCE_TABLE_NAME as string, `inst#${instanceId}`);
	const validRoots = (instanceData?.validRoots || {}) as Record<string, string>;
	const rootPath = validRoots[rootName];
	if (!rootPath) {
		return ResponseUtil.ValidationError("Invalid rootName");
	}

	await Permissions.ValidateResourceAccess(event, `filepath::${instanceId}::${rootName}`);

	const fullRootPath = `${baseRoot}${rootPath}`;
	const localPath = `${fullRootPath}/${relativePath}`;
	const s3Key = [instanceId, rootPath.slice(1), relativePath].join("/");
	const contentType = getContentType(relativePath);

	try {
		await S3.PutTextObject(bucketName, s3Key, body.content, contentType);
		const { commandId } = await S3.SyncS3ToInstance({
			instanceId,
			bucketName,
			sourceKey: s3Key,
			localPath,
			isFolder: false,
			overwriteExisting: true,
		});

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "write-file-content",
			status: "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: {
				instanceId,
				rootName,
				relativePath,
				s3Key,
				commandId,
			},
		});

		return ResponseUtil.Success({
			message: "File saved and sync started",
			commandId,
			s3Key,
			rootName,
			relativePath,
		});
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to write file");
	}
};
