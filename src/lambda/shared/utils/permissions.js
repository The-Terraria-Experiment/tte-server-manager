/**
 * Permission validation utilities
 * Checks user permissions against DynamoDB permission entries
 */

const { logAction } = require("./cloudwatchLogger");
const { CW_LOG_GENERAL } = require("../constants");
const { assertIsTruthyString, assertIsTruthy } = require("../middleware/assert");
const { getDynamoItem, updateDynamoItem } = require("./dynamo");
const { PERM_TABLE, SYSTEM_TABLE } = require("../vars");

const userCache = new Map();
const PERMISSION_CACHE_VERSION_UID = "cache#permissions";
const PERMISSION_CACHE_VERSION_POLL_MS = Number(process.env.PERMISSION_CACHE_VERSION_POLL_MS || 30 * 1000);

let lastSeenCacheVersion = null;
let lastVersionCheckAt = 0;

async function refreshCacheVersionIfNeeded() {
	const now = Date.now();
	if (lastSeenCacheVersion !== null && now - lastVersionCheckAt < PERMISSION_CACHE_VERSION_POLL_MS) {
		return;
	}

	lastVersionCheckAt = now;
	const cacheVersionItem = await getDynamoItem(SYSTEM_TABLE, PERMISSION_CACHE_VERSION_UID);
	const currentVersion = String(cacheVersionItem?.version || "0");

	if (lastSeenCacheVersion === null) {
		lastSeenCacheVersion = currentVersion;
		return;
	}

	if (lastSeenCacheVersion !== currentVersion) {
		dropcache();
		lastSeenCacheVersion = currentVersion;
	}
}

async function bumpPermissionCacheVersion() {
	const newVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const updatedAt = new Date().toISOString();

	const updated = await updateDynamoItem(SYSTEM_TABLE, PERMISSION_CACHE_VERSION_UID, {
		updates: {
			version: newVersion,
			updatedAt,
		}
	});

	if (!updated) {
		throw new Error("Failed to bump permission cache version");
	}

	dropcache();
	lastSeenCacheVersion = newVersion;
	lastVersionCheckAt = Date.now();

	return newVersion;
}

/**
 * Extract user sub from API Gateway event
 * Handles both Cognito authorizer and Lambda authorizer formats:
 * - Cognito: event.requestContext.authorizer.claims.sub
 * - Lambda: event.requestContext.authorizer['claims.sub']
 * @param {object} event - API Gateway event
 * @returns {string|null} User sub or null if not found
 */
function getUserSub(event) {
	const authorizer = event.requestContext?.authorizer;
	if (!authorizer) return null;
	
	// Try Cognito format first (nested object)
	if (authorizer.claims?.sub) {
		return authorizer.claims.sub;
	}
	
	// Try Lambda authorizer format (flat with dot notation)
	if (authorizer['claims.sub']) {
		return authorizer['claims.sub'];
	}
	
	return null;
}

/**
 * Validate user has permission for resource/action
 * @param {object} event - API Gateway event (contains requestContext.authorizer)
 * @param {string} permission - Permission to validate
 * @throws {Error} if permission denied
 */
async function validatePermission(event, permission) {
	assertIsTruthyString(permission, "validatePermission requires permission value");
	assertIsTruthy(event, "validatePermission requires a Gateway event");

	const userSub = getUserSub(event);
	if (!userSub) {
		logAction(CW_LOG_GENERAL, {
			userId: userSub ?? 'unknown',
			action: "attempt-perm-check",
			status: '401',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { permRequired: permission }
		});

		throw new Error("Unauthorized: No user context");
	}

	const permitted = await checkPermission(userSub, permission);
	if (!permitted) {
		logAction(CW_LOG_GENERAL, {
			userId: userSub ?? 'unknown',
			action: "attempt-perm-check",
			status: '403',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { permRequired: permission }
		});

		throw new Error(`Permission denied to <${userSub}> for resource <${event.httpMethod} ${event.resource}>`);
	}
}

/**
 * Check if user has specific permission
 */
async function checkPermission(userSub, permission) {
	await refreshCacheVersionIfNeeded();

	if (!userCache.has(userSub)) {
		const userData = await getDynamoItem(PERM_TABLE, `user#${userSub}`);
		userCache.set(userSub, userData);
	}

	const item = userCache.get(userSub);

	if (!item || !item.permissions) return false;

	const existingPerms = new Set(item.permissions || []);
	if (existingPerms.has(permission)) {
		return true;
	}

	return false;
}


/**
 * Validate user has permission for resource/action
 * @param {object} event - API Gateway event (contains requestContext.authorizer)
 * @param {string} resource - Resource to validate (e.g., 'instance::i-123', 'server::srv-456')
 * @throws {Error} if permission denied
 */
async function validateResourceAccess(event, resource) {
	assertIsTruthyString(resource, "validateResourceAccess requires resource value");
	assertIsTruthy(event, "validateResourceAccess requires a Gateway event");

	const userSub = getUserSub(event);
	if (!userSub) {
		logAction(CW_LOG_GENERAL, {
			userId: userSub ?? 'unknown',
			action: "attempt-resource-check",
			status: '401',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { resourceRequested: resource }
		});

		throw new Error("Unauthorized: No user context");
	}

	const permitted = await checkResourceAccess(userSub, resource);
	if (!permitted) {
		logAction(CW_LOG_GENERAL, {
			userId: userSub ?? 'unknown',
			action: "attempt-resource-check",
			status: '403',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { resourceRequested: resource }
		});

		throw new Error(`Permission denied to <${userSub}> for resource [${resource}]`);
	}
}

/**
 * Check if user has specific permission
 */
async function checkResourceAccess(userSub, resource) {
	await refreshCacheVersionIfNeeded();

	if (!userCache.has(userSub)) {
		const userData = await getDynamoItem(PERM_TABLE, `user#${userSub}`);
		userCache.set(userSub, userData);
	}
	
	const item = userCache.get(userSub);

	if (!item || !item.resourceAccess) return false;

	const existingResourcePerms = new Set(item.resourceAccess || []);
	if (existingResourcePerms.has(resource)) {
		return true;
	}

	return false;
}

function dropcache() {
	userCache.clear();
}


module.exports = {
	getUserSub,
	validatePermission,
	checkPermission,
	validateResourceAccess,
	checkResourceAccess,
	dropcache,
	bumpPermissionCacheVersion,
};
