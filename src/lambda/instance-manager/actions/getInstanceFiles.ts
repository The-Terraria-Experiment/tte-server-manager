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

	const rootPathB64 = Buffer.from(fullPath, "utf8").toString("base64");
	const commandOutput = await SSM.ExecuteDocumentGetResult(instanceId, documentName, {
		RootPathB64: [rootPathB64],
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
			commandId: commandOutput.commandID,
		},
	});

	return ResponseUtil.Success({
		rootName,
		rootPath,
		tree,
	});
};
