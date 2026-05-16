import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { Assert } from "../shared/utils/Assert.js";

type GetInstanceFilesBody = {
	rootName?: string;
	accept?: string[];
};

type FileTreeNode = {
	name: string;
	path: string;
	type: "dir" | "file" | "symlink";
	children?: FileTreeNode[];
	size?: number;
	mtime?: string;
};

const DB = new DynamoDao();
const SSM = new SsmDao();

const isSafeNickname = (nickname: string): boolean => {
	return typeof nickname === "string" && nickname.length > 0 && nickname.length <= 64 && /^[A-Za-z0-9_-]+$/.test(nickname);
};

const isSafeListValue = (value: string, maxLen: number): boolean => {
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > maxLen) return false;
	if (/[\\/\x00-\x1F]/.test(trimmed)) return false;
	return true;
};

const normalizeList = (values: string[], maxLen: number, lowerCase = false): string[] => {
	const normalized = values
		.map((value) => value.trim())
		.filter((value) => isSafeListValue(value, maxLen))
		.map((value) => (lowerCase ? value.toLowerCase() : value));

	return Array.from(new Set(normalized));
};

export const getInstanceFiles = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const tableName = process.env.INSTANCE_TABLE_NAME;
	if (!tableName) {
		return ResponseUtil.ValidationError("INSTANCE_TABLE_NAME environment variable is required");
	}

	const body = (event.parsedBody || {}) as GetInstanceFilesBody;
	const rootName = typeof body.rootName === "string" ? body.rootName.trim() : "";
	if (!rootName) {
		return ResponseUtil.ValidationError("rootName parameter is required");
	}
	if (!isSafeNickname(rootName)) {
		return ResponseUtil.ValidationError("Invalid rootName");
	}

	let acceptList: string[] = [];
	if (body.accept !== undefined) {
		if (!Array.isArray(body.accept)) {
			return ResponseUtil.ValidationError("accept must be an array of strings");
		}

		const invalid = body.accept.filter((value) => typeof value !== "string" || !isSafeListValue(value, 32));
		if (invalid.length > 0) {
			return ResponseUtil.ValidationError("accept contains invalid values", { invalid });
		}

		acceptList = normalizeList(body.accept, 32, true);
	}

	const instanceData = await DB.GetItem(tableName, `inst#${instanceId}`);
	const validRoots = (instanceData?.validRoots || {}) as Record<string, string>;
	const rootPath = validRoots[rootName];
	if (!rootPath) {
		return ResponseUtil.ValidationError("Invalid rootName");
	}

	await Permissions.ValidateResourceAccess(event, `filepath::${instanceId}::${rootName}`);

	const forcedRoot = process.env.BASE_ROOT;
	Assert.IsTruthyString(forcedRoot, "Base Root env var not set");

	const fullPath = forcedRoot + rootPath;

	const documentName = process.env.SSM_FILE_TREE_DOCUMENT;
	if (!documentName) {
		return ResponseUtil.ValidationError("SSM_FILE_TREE_DOCUMENT environment variable is required");
	}

	const ignoreRaw = process.env.SSM_FILE_TREE_IGNORE_DIRS || "";
	const ignoreList = normalizeList(ignoreRaw.split(","), 128, false);

	const rootPathB64 = Buffer.from(fullPath, "utf8").toString("base64");
	const commandOutput = await SSM.ExecuteDocumentGetResult(instanceId, documentName, {
		RootPathB64: [rootPathB64],
		IgnoreDirNames: ignoreList.length > 0 ? ignoreList : [""],
		AcceptExtensions: acceptList.length > 0 ? acceptList : [""],
	});
	const output = (commandOutput.stdout || "").trim();
	if (!output) {
		return ResponseUtil.Error("Failed to read file tree", 500, "SSM_EMPTY_OUTPUT");
	}

	let tree: FileTreeNode;
	try {
		tree = JSON.parse(output) as FileTreeNode;
	} catch {
		return ResponseUtil.Error("Failed to parse file tree output", 500, "SSM_PARSE_ERROR", {
			output: Parsers.Truncate(output),
		});
	}

	if (tree && tree.type === "dir") {
		tree.name = rootName;
	}

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "get-instance-files",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: {
			instanceId,
			rootName,
			rootPath,
			fullPath,
			ignoreDirs: ignoreList,
			acceptExtensions: acceptList,
			commandId: commandOutput.commandID,
		},
	});

	return ResponseUtil.Success({
		rootName,
		rootPath,
		tree,
	});
};
