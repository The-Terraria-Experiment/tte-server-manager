/**
 * List all ban entries
 */

const {callTShockAPI} = require("./tshockApi");
const {successResponse, notFoundError, errorResponse} = require("../shared/utils/response");
const {getInstanceStatus} = require("../shared/utils/aws");
const {logAction} = require("../shared/utils/cloudwatchLogger");
const {FUNC_NAMES} = require("../shared/constants");
const {validateResourceAccess, getUserSub} = require("../shared/utils/permissions");

async function handle(event) {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return notFoundError("Server ID");
	}

	await validateResourceAccess(event, `server::${serverId}`);

	try {
		// For now, treat serverId as the EC2 instance ID to obtain IP
		const instance = await getInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === "PENDING") {
			return errorResponse(`Instance ${serverId} has no reachable public IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		const result = await callTShockAPI(getUserSub(event), ip, "/v3/bans/list");

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: getUserSub(event) ?? "unknown",
			action: "get-banlist",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: {ip, instanceId: serverId},
		});

		return successResponse({ result });
	} catch (err) {
		return errorResponse(err.message || "Failed to fetch ban list");
	}
}

module.exports = {handle};
