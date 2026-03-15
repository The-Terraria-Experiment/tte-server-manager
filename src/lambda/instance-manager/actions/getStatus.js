/**
 * Get specific instance status
 */

const { validationError } = require("../shared/utils/response");
const { FUNC_NAMES } = require("../shared/constants");
const {getInstanceStatus} = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const {successResponse} = require("../shared/utils/response");
const { validateResourceAccess, getUserSub } = require("../shared/utils/permissions");

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	await validateResourceAccess(event, `instance::${instanceId}`);

	const status = await getInstanceStatus(instanceId);

	logAction(FUNC_NAMES.INST_MGR, {
		userId: getUserSub(event) ?? 'unknown',
		action: "get-status",
		status: 'ok',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { status }
	});

	return successResponse({ instance: status });
}

module.exports = {handle};
