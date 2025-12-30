/**
 * List all instances with status
 */

const {getInstanceStatus} = require("../../shared/utils/aws");
const {successResponse} = require("../../shared/utils/response");

async function handle(event) {
	const instanceIds = (process.env.EC2_INSTANCE_IDS || "").split(",").filter(Boolean);

	const instances = [];

	for (const instanceId of instanceIds) {
		const idata = await getInstanceStatus(instanceId);
		instances.push(idata);
	}

	return successResponse({instances});
}

module.exports = {handle};
