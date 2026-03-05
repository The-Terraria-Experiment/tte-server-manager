/**
 * Overwrite a user's effective permissions
 */

const {successResponse} = require("../shared/utils/response");
const {FUNC_NAMES} = require("../shared/constants");
const {logError} = require("../shared/middleware/errorHandler");
const {updateDynamoItem} = require("../shared/utils/dynamo");
const { logAction } = require("../shared/utils/cloudwatchLogger");

async function handle(event) {
	if (!event.parsedBody || !event.parsedBody.resourceAccess || !event.parsedBody.userID) {
		return logError(new Error("Missing data in writeResourcePermissions"));
	}

	const deduplicated = Array.from(new Set(event.parsedBody.resourceAccess || []));
	const updateUser = event.parsedBody.userID;

	const updated = await updateDynamoItem(process.env.PERM_TABLE, updateUser, {
		updates: {
			resourceAccess: deduplicated,
		},
	});

	logAction(FUNC_NAMES.USER_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: "write-resource-permissions",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { updatedUser: updateUser, permissions: deduplicated }
	});

	return successResponse({permissions: updated?.resourceAccess, updateUser});
}

module.exports = {handle};
