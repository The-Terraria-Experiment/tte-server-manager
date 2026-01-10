/**
 * Edit the valid path roots for an instance
 */

const {successResponse, validationError} = require("../shared/utils/response");
const {updateDynamoItem} = require("../shared/utils/dynamo");
const path = require("path");

// Validate a single nickname (key in validRoots)
function isSafeNickname(nickname) {
	return typeof nickname === "string"
		&& nickname.length > 0
		&& nickname.length <= 64
		&& /^[A-Za-z0-9_-]+$/.test(nickname);
}

// Validate a POSIX-style absolute path without traversal or control chars
function isSafePosixPath(p) {
	if (typeof p !== "string") return false;
	const trimmed = p.trim();
	if (trimmed.length === 0) return false;
	// Must be absolute and POSIX-style
	if (!trimmed.startsWith("/")) return false;
	// Disallow Windows-style separators
	if (trimmed.includes("\\")) return false;
	// Disallow control chars and null bytes
	if (/[\x00-\x1F]/.test(trimmed)) return false;
	// Disallow ~ or environment variable expansions
	if (trimmed.startsWith("~") || trimmed.includes("${") || trimmed.includes("$(")) return false;
	// Disallow path traversal segments
	const segments = trimmed.split("/");
	if (segments.some(seg => seg === "..")) return false;
	// Normalize and ensure it remains absolute
	const normalized = path.posix.normalize(trimmed);
	if (!normalized.startsWith("/")) return false;
	return true;
}

function validatePaths(paths) {
	if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
		return { valid: false, errors: ["paths must be an object map of nickname -> path"] };
	}
	const errors = [];
	const entries = Object.entries(paths);
	if (entries.length === 0) {
		errors.push("paths must contain at least one entry");
	}
	for (const [nickname, p] of entries) {
		if (!isSafeNickname(nickname)) {
			errors.push(`Invalid nickname: ${nickname}`);
		}
		if (!isSafePosixPath(p)) {
			errors.push(`Invalid path for ${nickname}: ${String(p)}`);
		}
	}
	return { valid: errors.length === 0, errors };
}

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	const tableName = process.env.INSTANCE_TABLE_NAME;

	if (!tableName) {
		return validationError("INSTANCE_TABLE_NAME environment variable is required");
	}

	let body = event.parsedBody;

	if (!body) {
		try {
			body = JSON.parse(event.body || "{}");
		} catch (err) {
			return validationError("Request body must be valid JSON");
		}
	}

	const paths = body?.paths;

	if (!paths) {
		return validationError("paths are required");
	}

	const { valid, errors } = validatePaths(paths);
	if (!valid) {
		return validationError("Invalid paths", { errors });
	}

	const key = `inst#${instanceId}`;
	const timestamp = new Date().toISOString();

	const updatedItem = await updateDynamoItem(tableName, key, {
		updates: {
			validRoots: paths,
			updatedAt: timestamp
		}
	});

	const updatedRoots = updatedItem?.validRoots || {};

	return successResponse({
		instanceId,
		validRoots: updatedRoots,
		updatedAt: updatedItem?.updatedAt || timestamp,
	});
}

module.exports = {handle};
