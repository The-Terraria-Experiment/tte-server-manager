import type { Context } from "aws-lambda";
import { posix } from "node:path";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";

type EditPathsBody = {
	paths?: Record<string, string>;
	worldPaths?: string[];
};

const DB = new DynamoDao();

const isSafeNickname = (nickname: string): boolean => {
	return typeof nickname === "string" && nickname.length > 0 && nickname.length <= 64 && /^[A-Za-z0-9_-]+$/.test(nickname);
};

const isSafePosixPath = (inputPath: string): boolean => {
	if (typeof inputPath !== "string") return false;
	const trimmed = inputPath.trim();
	if (trimmed.length === 0) return false;
	if (!trimmed.startsWith("/")) return false;
	if (trimmed.includes("\\")) return false;
	if (/[\x00-\x1F]/.test(trimmed)) return false;
	if (trimmed.startsWith("~") || trimmed.includes("${") || trimmed.includes("$(")) return false;

	const segments = trimmed.split("/");
	if (segments.some((segment) => segment === "..")) return false;

	const normalized = posix.normalize(trimmed);
	if (!normalized.startsWith("/")) return false;

	return true;
};

const validatePaths = (paths: Record<string, string>): { valid: boolean; errors: string[] } => {
	if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
		return { valid: false, errors: ["paths must be an object map of nickname -> path"] };
	}

	const errors: string[] = [];
	const entries = Object.entries(paths);
	if (entries.length === 0) {
		errors.push("paths must contain at least one entry");
	}

	for (const [nickname, pathValue] of entries) {
		if (!isSafeNickname(nickname)) {
			errors.push(`Invalid nickname: ${nickname}`);
		}
		if (!isSafePosixPath(pathValue)) {
			errors.push(`Invalid path for ${nickname}: ${String(pathValue)}`);
		}
	}

	return { valid: errors.length === 0, errors };
};

const validateWorldPaths = (worldPaths: string[]): { valid: boolean; errors: string[] } => {
	if (!worldPaths || !Array.isArray(worldPaths)) {
		return { valid: false, errors: ["worldPaths must be an array of paths"] };
	}

	const errors: string[] = [];
	for (const worldPath of worldPaths) {
		if (!isSafePosixPath(worldPath)) {
			errors.push(`Invalid world path ${String(worldPath)}`);
		}
	}

	return { valid: errors.length === 0, errors };
};

export const editPaths = async (event: AuthorizedEvent, context: Context) => {
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

	const { paths, worldPaths } = event.parsedBody as EditPathsBody;
	if (!paths) {
		return ResponseUtil.ValidationError("paths are required");
	}
	if (!worldPaths) {
		return ResponseUtil.ValidationError("worldPaths are required");
	}

	const { valid: pathsValid, errors: pathErrors } = validatePaths(paths);
	if (!pathsValid) {
		return ResponseUtil.ValidationError("Invalid paths", { pathErrors });
	}

	const { valid: worldPathsValid, errors: worldPathErrors } = validateWorldPaths(worldPaths);
	if (!worldPathsValid) {
		return ResponseUtil.ValidationError("Invalid world paths", { worldPathErrors });
	}

	const key = `inst#${instanceId}`;
	const timestamp = new Date().toISOString();
	const filteredWorldPaths = worldPaths.filter((worldPath) => Object.values(paths).includes(worldPath));

	const updatedItem = await DB.UpdateItem(tableName, key, {
		updates: {
			validRoots: paths,
			worldPaths: filteredWorldPaths,
			updatedAt: timestamp,
		},
	});

	const updatedRoots = updatedItem?.validRoots || {};

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event) ?? "unknown",
		action: "edit-paths",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, updatedRoots },
	});

	return ResponseUtil.Success({
		instanceId,
		validRoots: updatedRoots,
		updatedAt: updatedItem?.updatedAt || timestamp,
	});
};
