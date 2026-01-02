/**
 * Update the current user's display name
 */

const {successResponse} = require("../shared/utils/response");
const {PERM_TABLE} = require("../shared/constants");
const {logError} = require("../shared/middleware/errorHandler");
const {updateDynamoItem} = require("../shared/utils/dynamo");

async function handle(event) {
	if (!event.parsedBody || !event.parsedBody.username) {
		return logError(new Error("Missing data in setUsername"));
	}

	const userSub = event.requestContext.authorizer?.claims?.sub;

	const updated = await updateDynamoItem(PERM_TABLE, `user#${userSub}`, {
		updates: {
			displayName: event.parsedBody.username,
		},
	});

	return successResponse({ displayName: updated.displayName, userID: userSub });
}

module.exports = {handle};
