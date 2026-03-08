/**
 * Set a site message and/or disable site
 */

const { updateDynamoItem } = require("../shared/utils/dynamo");
const {successResponse} = require("../shared/utils/response");
const { SYSTEM_TABLE } = require("../shared/vars");

async function handle(event) {
	const body = JSON.parse(event.body || '{}');
	const { message, disableSite } = body;

	await updateDynamoItem(SYSTEM_TABLE, process.env.SYS_MSG_KEY, {
		updates: {
			enabled: !disableSite,
			message
		}
	});
	
	return successResponse({ success: true });
}

module.exports = {handle};
