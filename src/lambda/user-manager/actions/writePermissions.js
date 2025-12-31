/**
 * Overwrite a user's effective permissions
 */

const {successResponse} = require("../shared/utils/response");
const {PERM_TABLE} = require("../shared/constants");
const {logError} = require("../shared/middleware/errorHandler");
const {updateDynamoItem} = require("../shared/utils/dynamo");

async function handle(event) {
	if (!event.parsedBody || !event.parsedBody.permissions || !event.parsedBody.userID) {
		return logError(new Error("Missing data in writePermissions"));
	}

	const deduplicated = Array.from(new Set(event.parsedBody.permissions || []));
	const updateUser = event.parsedBody.userID;

	const updated = await updateDynamoItem(PERM_TABLE, `user#${updateUser}`, {
		updates: {
			permissions: deduplicated,
		},
	});

	return successResponse({permissions: updated?.permissions, updateUser});
}

module.exports = {handle};
