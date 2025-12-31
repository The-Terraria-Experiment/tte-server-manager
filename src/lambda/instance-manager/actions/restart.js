/**
 * Restart EC2 instance (stop then start)
 */

const {executeSSMCommand, getInstanceStatus} = require("../shared/utils/aws");
const {successResponse, validationError} = require("../shared/utils/response");

/**
 * Poll for instance to reach target state with timeout
 */
async function waitForInstanceState(instanceId, targetState, maxWaitMs = 180000) {
	const pollIntervalMs = 10000; // Check every 10 seconds
	const startTime = Date.now();

	while (Date.now() - startTime < maxWaitMs) {
		try {
			const status = await getInstanceStatus(instanceId);
			if (status.state === targetState) {
				return status;
			}
		} catch (error) {
			console.warn(`Error checking instance status: ${error.message}`);
		}
		
		// Wait before next poll
		await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
	}

	throw new Error(`Instance did not reach "${targetState}" state within ${maxWaitMs}ms`);
}

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	try {
		// Send reboot command
		const commandResult = await executeSSMCommand(instanceId, ["sudo reboot"]);
		
		// Wait for instance to come back up (max 3 minutes)
		const finalStatus = await waitForInstanceState(instanceId, "running");
		
		return successResponse({
			message: "Instance restarted successfully",
			instanceId,
			commandId: commandResult.commandId,
			finalState: finalStatus.state,
			publicIp: finalStatus.publicIp,
		});
	} catch (error) {
		console.error(`Failed to restart instance ${instanceId}:`, error);
		throw error;
	}
}

module.exports = {handle};
