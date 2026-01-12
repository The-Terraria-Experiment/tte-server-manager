/**
 * Get all permission entries from the table
 */

const {successResponse} = require("../shared/utils/response");
const { PERM_TABLE, FUNC_NAMES } = require("../shared/constants");
const { scanDynamoTable } = require("../shared/utils/dynamo");
const { logAction } = require("../shared/utils/cloudwatchLogger");

async function handle(event) {
	const allEntries = await scanDynamoTable(PERM_TABLE);

	const filteredEntries = (allEntries || []).map(e => ({
		permissions: e.permissions,
		userID: e.uid,
		username: e.username,
		displayName: e.displayName
	}));

	logAction(FUNC_NAMES.USER_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: "read-permissions",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
	});

	return successResponse({entries: filteredEntries});
}

module.exports = {handle};
