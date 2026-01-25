/**
 * Drop the user permission cache
 */

const { CW_LOG_GENERAL } = require("../shared/constants");
const { logActionCond } = require("../shared/utils/cloudwatchLogger");
const { dropcache } = require("../shared/utils/permissions");
const {successResponse} = require("../shared/utils/response");

async function handle(event) {
	dropcache();

	logActionCond(4, CW_LOG_GENERAL, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: 'drop-user-cache',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { }
	});

	return successResponse({ message: "Cache dropped" });
}

module.exports = {handle};
