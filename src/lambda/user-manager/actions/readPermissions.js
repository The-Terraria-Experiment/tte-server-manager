/**
 * Get all permission entries from the table
 */

const {successResponse} = require("../../shared/utils/response");
const { PERM_TABLE } = require("../shared/constants");
const { scanDynamoTable } = require("../shared/utils/dynamo");

async function handle(event) {
	const allEntries = await scanDynamoTable(PERM_TABLE);

	return successResponse({entries: allEntries});
}

module.exports = {handle};
