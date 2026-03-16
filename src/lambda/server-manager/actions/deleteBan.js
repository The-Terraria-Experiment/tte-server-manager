/**
 * Remove a ban from the system
 */

const {callTShockAPI} = require("./tshockApi");
const {successResponse, notFoundError, errorResponse} = require("../shared/utils/response");
const {getInstanceStatus} = require("../shared/utils/aws");
const {logAction} = require("../shared/utils/cloudwatchLogger");
const {FUNC_NAMES} = require("../shared/constants");
const {validateResourceAccess, getUserSub} = require("../shared/utils/permissions");

async function handle(event) {
	const serverId = event.pathParameters?.id;
	const { ticketNumber, fullDelete } = event.parsedBody;

	if (!serverId) {
		return notFoundError("Server ID");
	}

	if (ticketNumber === undefined) {
		return notFoundError("Ticket number");
	}

	if (fullDelete === undefined) {
		return notFoundError("FullDelete");
	}

	await validateResourceAccess(event, `server::${serverId}`);

	try {
		// For now, treat serverId as the EC2 instance ID to obtain IP
		const instance = await getInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === "PENDING") {
			return errorResponse(`Instance ${serverId} has no reachable public IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		const status = await callTShockAPI(getUserSub(event), ip, "/v3/bans/destroy", { ticketNumber, fullDelete });

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: getUserSub(event) ?? "unknown",
			action: "delete-ban",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: {ip, instanceId: serverId, status},
		});

		return successResponse({server: status, players: playerData});
	} catch (err) {
		return errorResponse(err.message || "Failed to destroy ban entry");
	}
}

module.exports = {handle};
