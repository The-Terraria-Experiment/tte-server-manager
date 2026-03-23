/**
 * Overwrite a user's effective permissions
 */

const {successResponse} = require("../shared/utils/response");
const {FUNC_NAMES} = require("../shared/constants");
const {logError} = require("../shared/middleware/errorHandler");
const {updateDynamoItem} = require("../shared/utils/dynamo");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { PERM_TABLE } = require("../shared/vars");
const { getUserSub, bumpPermissionCacheVersion } = require("../shared/utils/permissions");

async function handle(event) {
	if (!event.parsedBody || !event.parsedBody.permissions || !event.parsedBody.userID) {
		return logError(new Error("Missing data in writePermissions"));
	}

	const deduplicated = Array.from(new Set(event.parsedBody.permissions || []));
	const updateUser = event.parsedBody.userID;

	const updated = await updateDynamoItem(PERM_TABLE, updateUser, {
		updates: {
			permissions: deduplicated,
		},
	});

	const cacheVersion = await bumpPermissionCacheVersion();

	logAction(FUNC_NAMES.USER_MGR, {
		userId: getUserSub(event) ?? 'unknown',
		action: "write-permissions",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { updatedUser: updateUser, permissions: deduplicated }
	});

	return successResponse({permissions: updated?.permissions, updateUser, cacheVersion});
}

module.exports = {handle};
