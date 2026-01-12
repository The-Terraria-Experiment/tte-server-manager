/**
 * List all instances with status
 */

const { FUNC_NAMES } = require("../shared/constants");
const {getMultipleInstanceStatus} = require("../shared/utils/aws");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const {successResponse} = require("../shared/utils/response");

async function handle(event) {
	const instanceIds = (process.env.EC2_INSTANCE_IDS || "").split(",").filter(Boolean);

	// Batch fetch all instances in a single API call
	const instancesData = await getMultipleInstanceStatus(instanceIds);

	// Map to simplified response format
	const instances = instancesData.map(idata => ({
		id: idata.id,
		state: idata.state,
		name: idata.name
	}));

	logAction(FUNC_NAMES.INST_MGR, {
		userId: event.request.userAttributes.sub ?? 'unknown',
		action: "list",
		status: 'ok',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { instances }
	});

	return successResponse({ instances });
}

module.exports = {handle};
