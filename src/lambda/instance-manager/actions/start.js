/**
 * Start EC2 instance
 */

const { validateResourceAccess } = require("../shared/utils/permissions");
const { FUNC_NAMES } = require("../shared/constants");
const {startInstance} = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const {successResponse, validationError} = require("../shared/utils/response");

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	await validateResourceAccess(event, `instance::${instanceId}`);

	await startInstance(instanceId);

	logAction(FUNC_NAMES.INST_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: "start",
		status: 'ok',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { instanceId }
	});

	return successResponse({message: "Instance starting", instanceId});
}

module.exports = {handle};
