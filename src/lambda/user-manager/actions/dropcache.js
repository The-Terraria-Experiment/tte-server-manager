/**
 * Drop the user permission cache
 */

const { CW_LOG_GENERAL } = require("../shared/constants");
const { logActionCond } = require("../shared/utils/cloudwatchLogger");
const { dropcache, bumpPermissionCacheVersion, getUserSub } = require("../shared/utils/permissions");
const {successResponse} = require("../shared/utils/response");

async function handle(event) {
	const cacheVersion = await bumpPermissionCacheVersion();
	dropcache();

	logActionCond(4, CW_LOG_GENERAL, {
		userId: getUserSub(event) ?? 'unknown',
		action: 'drop-user-cache',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { cacheVersion }
	});

	return successResponse({ message: "Cache dropped", cacheVersion });
}

module.exports = {handle};
