/**
 * Overwrite a user's effective permissions
 */

const {successResponse} = require("../shared/utils/response");
const {PERM_TABLE, FUNC_NAMES} = require("../shared/constants");
const {logError} = require("../shared/middleware/errorHandler");
const {updateDynamoItem} = require("../shared/utils/dynamo");
const { logAction } = require("../shared/utils/cloudwatchLogger");

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

	logAction(FUNC_NAMES.USER_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: "write-permissions",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { updatedUser: updateUser, permissions: deduplicated }
	});

	return successResponse({permissions: updated?.permissions, updateUser});
}

module.exports = {handle};
