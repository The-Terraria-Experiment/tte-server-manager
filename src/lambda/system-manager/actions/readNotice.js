/**
 * Set a site message and/or disable site
 */

const { getDynamoItem } = require("../shared/utils/dynamo");
const {successResponse} = require("../shared/utils/response");
const { SYSTEM_TABLE } = require("../shared/vars");

async function handle(event) {
	const sysMessage = await getDynamoItem(SYSTEM_TABLE, process.env.SYS_MSG_KEY);
	
	return successResponse({ message: sysMessage.message, enabled: sysMessage.enabled });
}

module.exports = {handle};
