/**
 * Update the current user's display name
 */

const {successResponse} = require("../shared/utils/response");
const {FUNC_NAMES} = require("../shared/constants");
const {logError} = require("../shared/middleware/errorHandler");
const {updateDynamoItem} = require("../shared/utils/dynamo");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { getUserSub } = require("../shared/utils/permissions");
const { PERM_TABLE } = require("../shared/vars");

async function handle(event) {
	if (!event.parsedBody || !event.parsedBody.username) {
		return logError(new Error("Missing data in setUsername"));
	}

	const userSub = getUserSub(event);

	const updated = await updateDynamoItem(PERM_TABLE, `user#${userSub}`, {
		updates: {
			displayName: event.parsedBody.username,
		},
	});

	logAction(FUNC_NAMES.USER_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: "set-username",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { newDisplayName: updated.displayName }
	});

	return successResponse({ displayName: updated.displayName, userID: userSub });
}

module.exports = {handle};
