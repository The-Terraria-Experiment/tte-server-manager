/**
 * Clear the site message and re-enable the site
 */

const { updateDynamoItem } = require("../shared/utils/dynamo");
const {successResponse} = require("../shared/utils/response");

async function handle(event) {
	await updateDynamoItem(process.env.SYSTEM_TABLE, process.env.SYS_MSG_KEY, {
		updates: {
			enabled: true,
			message: ""
		}
	});
	
	return successResponse({ success: true });
}

module.exports = {handle};
