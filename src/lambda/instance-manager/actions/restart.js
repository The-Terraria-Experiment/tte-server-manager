/**
 * Restart EC2 instance
 */

const { validateResourceAccess, getUserSub } = require("../shared/utils/permissions");
const { FUNC_NAMES } = require("../shared/constants");
const {rebootInstance} = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const {successResponse, validationError} = require("../shared/utils/response");

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	await validateResourceAccess(event, `instance::${instanceId}`);

	await rebootInstance(instanceId);

	logAction(FUNC_NAMES.INST_MGR, {
		userId: getUserSub(event) ?? 'unknown',
		action: "restart",
		status: 'ok',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { instanceId }
	});

	return successResponse({message: "Instance rebooting", instanceId});
}

module.exports = {handle};
