import type { Context } from "aws-lambda";
import { posix } from "node:path";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { S3Dao } from "../shared/aws/S3.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { Assert } from "../shared/utils/Assert.js";

type ReadFileContentBody = {
	rootName?: string;
	relativePath?: string;
	forceRefresh?: boolean;
};

const DB = new DynamoDao();
const S3 = new S3Dao();
const SSM = new SsmDao();

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

export const readFileContent = async (event: AuthorizedEvent, context: Context) => {
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

	const body = (event.parsedBody || {}) as ReadFileContentBody;
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

	const instanceData = await DB.GetItem(process.env.INSTANCE_TABLE_NAME as string, `inst#${instanceId}`);
	const validRoots = (instanceData?.validRoots || {}) as Record<string, string>;
	const rootPath = validRoots[rootName];
	if (!rootPath) {
		return ResponseUtil.ValidationError("Invalid rootName");
	}

	await Permissions.ValidateResourceAccess(event, `filepath::${instanceId}::${rootName}`);

	const forceRefresh = body.forceRefresh === true;
	const fullRootPath = `${baseRoot}${rootPath}`;
	const localPath = `${fullRootPath}/${relativePath}`;
	const s3Key = [instanceId, rootPath.slice(1), relativePath].join("/");

	let content = forceRefresh ? false : await S3.GetObject(bucketName, s3Key);
	let syncCommandId: string | undefined;
	let refreshed = false;

	if (forceRefresh || content === false) {
		const uploadResult = await S3.SyncInstanceFileToS3(instanceId, localPath, bucketName, s3Key);
		syncCommandId = uploadResult.commandId;
		await SSM.PollForCommandCompletion(uploadResult.commandId, instanceId);
		content = await S3.GetObject(bucketName, s3Key);
		refreshed = true;
	}

	if (content === false) {
		return ResponseUtil.NotFoundError("File");
	}

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-file-content",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: {
			instanceId,
			rootName,
			relativePath,
			s3Key,
			syncCommandId,
			refreshed,
		},
	});

	return ResponseUtil.Success({
		content,
		s3Key,
		rootName,
		relativePath,
		syncCommandId,
		refreshed,
	});
};
