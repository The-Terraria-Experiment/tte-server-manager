/**
 * Drop the tshock token permission cache
 */

const { CW_LOG_GENERAL } = require("../shared/constants");
const { logActionCond } = require("../shared/utils/cloudwatchLogger");
const {successResponse} = require("../shared/utils/response");
const { dropTokenCache } = require("./tshockApi");

async function handle(event) {
	dropTokenCache();

	logActionCond(4, CW_LOG_GENERAL, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: 'drop-tshock-token-cache',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { }
	});

	return successResponse({ message: "Token cache dropped" });
}

module.exports = {handle};
