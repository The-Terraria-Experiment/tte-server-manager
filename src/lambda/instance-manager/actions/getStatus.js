/**
 * Get specific instance status
 */

const {getInstanceStatus} = require("../shared/utils/aws");
const {successResponse, notFoundError} = require("../shared/utils/response");

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return notFoundError("Instance ID");
	}

	const status = await getInstanceStatus(instanceId);

	return successResponse({instance: status});
}

module.exports = {handle};
