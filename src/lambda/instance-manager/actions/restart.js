/**
 * Restart EC2 instance
 */

const {rebootInstance} = require("../shared/utils/aws");
const {successResponse, validationError} = require("../shared/utils/response");

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	await rebootInstance(instanceId);

	return successResponse({message: "Instance rebooting", instanceId});
}

module.exports = {handle};
