/**
 * List all instances with status
 */

const {getMultipleInstanceStatus} = require("../shared/utils/aws");
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

	return successResponse({ instances });
}

module.exports = {handle};
