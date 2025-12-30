/**
 * Start EC2 instance
 */

const {startInstance} = require("../../shared/utils/aws");
const {successResponse, validationError} = require("../../shared/utils/response");

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	await startInstance(instanceId);

	return successResponse({message: "Instance starting", instanceId});
}

module.exports = {handle};
