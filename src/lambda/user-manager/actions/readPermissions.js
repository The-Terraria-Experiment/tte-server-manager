/**
 * Get all permission entries from the table
 */

const {successResponse} = require("../shared/utils/response");
const { PERM_TABLE } = require("../shared/constants");
const { scanDynamoTable } = require("../shared/utils/dynamo");

async function handle(event) {
	const allEntries = await scanDynamoTable(PERM_TABLE);

	const filteredEntries = (allEntries || []).map(e => ({
		permissions: e.permissions,
		userID: e.uid,
		username: e.username,
		displayName: e.displayName
	}));

	return successResponse({entries: filteredEntries});
}

module.exports = {handle};
