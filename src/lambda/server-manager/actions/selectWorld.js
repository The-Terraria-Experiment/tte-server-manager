/**
 * Start a tshock server with a selected world
 */

const {successResponse, validationError} = require("../shared/utils/response");
const { executeSSMCommand } = require("../shared/utils/aws");
const path = require("path");

/**
 * Safely construct TShock command with flags
 * @param {string} tshockPath - Path to TShock executable
 * @param {string} worldPath - Path to world file
 * @param {number} port - Server port
 * @param {number} maxPlayers - Maximum player count
 * @param {string} password - Server password (optional)
 * @returns {string} Properly formatted command
 */
function buildTShockCommand(tshockPath, worldPath, port, maxPlayers, password) {
	// Validate and quote paths to handle spaces safely
	const quotedTshockPath = `"${process.env.BASE_ROOT}${tshockPath}"`;
	const worldPathNormalized = path.posix.normalize(`${process.env.BASE_ROOT}${worldPath}`);
	const escapedPath = worldPathNormalized.replace(/"/g, '\\"');
	const quotedWorldPath = `"${escapedPath}"`;

	// Build command with flags
	let command = `${quotedTshockPath} -world ${quotedWorldPath}`;
	command += ` -port ${parseInt(port)}`;
	command += ` -maxplayers ${parseInt(maxPlayers)}`;

	// Only add password flag if provided and non-empty
	if (password && password.trim()) {
		command += ` -password "${password}"`;
	}

	return command;
}

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	// Extract body parameters
	const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
	const {worldFilePath, port, maxPlayers, password} = body;

	// Validate required parameters
	if (!worldFilePath) {
		return validationError("World file path is required");
	}
	if (!port) {
		return validationError("Port is required");
	}
	if (!maxPlayers) {
		return validationError("Max players is required");
	}

	// Validate password contains only alphanumeric characters and underscores
	if (password && !/^[a-zA-Z0-9_]+$/.test(password)) {
		return validationError("Password must contain only alphanumeric characters and underscores");
	}

	// Validate port contains only numeric characters
	if (password && !/^[0-9]+$/.test(port)) {
		return validationError("Password must contain only alphanumeric characters and underscores");
	}

	// Validate player cap contains only numeric characters
	if (password && !/^[0-9]+$/.test(maxPlayers)) {
		return validationError("Password must contain only alphanumeric characters and underscores");
	}

	// Get TShock executable path from environment
	const tshockPath = process.env.TSHOCK_PATH;
	if (!tshockPath) {
		return validationError("TShock executable path not configured (TSHOCK_PATH env var missing)");
	}

	const instanceData = await getDynamoItem(process.env.INSTANCE_TABLE_NAME, `inst#${instanceId}`);
	const worldPaths = instanceData?.worldPaths || [];

	if (!worldPaths.some(validPath => worldFilePath.startsWith(validPath))) {
		return validationError("File path does not fall within a designated world files folder");
	}

	// Build the command
	const command = buildTShockCommand(tshockPath, worldFilePath, port, maxPlayers, password);

	// Execute command on EC2 instance via SSM
	// Note: Port forwarding may need to be handled at the security group level
	// or via iptables on the EC2 instance if not already configured
	try {
		const result = await executeSSMCommand(instanceId, [command]);
		return successResponse({
			message: "TShock server starting",
			instanceId,
			commandId: result.commandId,
			worldFile: worldFilePath,
			port,
		});
	} catch (error) {
		return validationError(`Failed to execute command: ${error.message}`);
	}
}

module.exports = {handle};
