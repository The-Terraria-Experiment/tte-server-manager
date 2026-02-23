/**
 * Get permission entries for the current user only
 */

const {successResponse} = require("../shared/utils/response");
const { PERM_TABLE } = require("../shared/constants");
const { getDynamoItem } = require("../shared/utils/dynamo");
const { getUserSub } = require("../shared/utils/permissions");

async function handle(event) {
	// Get the current user's sub from the authorizer
	const userSub = getUserSub(event);
	
	if (!userSub) {
		return successResponse({entries: []});
	}
	
	const userPermissions = await getDynamoItem(PERM_TABLE, `user#${userSub}`);

	return successResponse({entries: userPermissions || []});
}

module.exports = {handle};
