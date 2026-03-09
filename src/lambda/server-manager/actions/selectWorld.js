/**
 * Start a tshock server with a selected world
 */

const {successResponse, validationError} = require("../shared/utils/response");
const { executeSSMCommand } = require("../shared/utils/aws");
const { getDynamoItem } = require("../shared/utils/dynamo");
const path = require("path");
const { getSSMCommandResult } = require("../shared/utils/aws");
const { delay } = require("../shared/utils/delay");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("../shared/constants");
const { validateResourceAccess } = require("../shared/utils/permissions");

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
	const baseRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	const quotedTshockPath = `"${baseRoot}${tshockPath}"`;
	const worldPathNormalized = path.posix.normalize(`${baseRoot}${worldPath}`);
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

	// Append stdout redirection into daily log file when configured (otherwise drop to /dev/null)
	const outLogRoot = (process.env.TSHOCK_OUT_LOGS || "").trim().replace(/\/$/, "");
	if (outLogRoot) {
		const outLogPath = path.posix.join(outLogRoot, `${new Date().toISOString().slice(0, 10)}.log`);
		const escapedOutLogPath = outLogPath.replace(/"/g, '\\"');
		command += ` 1>> "${escapedOutLogPath}"`;
	} else {
		command += " 1> /dev/null";
	}

	// Append stderr redirection into daily log file when configured (otherwise drop to /dev/null)
	const errLogRoot = (process.env.TSHOCK_ERR_LOGS || "").trim().replace(/\/$/, "");
	if (errLogRoot) {
		const errLogPath = path.posix.join(errLogRoot, `${new Date().toISOString().slice(0, 10)}.log`);
		const escapedErrLogPath = errLogPath.replace(/"/g, '\\"');
		command += ` 2>> "${escapedErrLogPath}"`;
	} else {
		command += " 2> /dev/null";
	}

	// Run detached so SSM can exit while server keeps running
	const workingDir = (process.env.TSHOCK_WD || "").replace(/\/$/, "");
	const cdRoot = `cd "${workingDir}"`;
	// In SSM's non-interactive shell, plain nohup backgrounding is the most reliable detach pattern.
	const detached = `nohup ${command} < /dev/null & echo "TShock launch dispatched"`;
	return `runuser -u ubuntu -- /bin/bash -c '${cdRoot} && ${detached}'`;
}

//start temp

function previewText(value, maxLength = 400) {
	if (!value) {
		return "";
	}
	const text = String(value).trim();
	return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function probeSSMCommandStatus(instanceId, commandId, options = {}) {
	const attempts = Number(options.attempts ?? Number(process.env.SSM_LAUNCH_PROBE_ATTEMPTS || 3));
	const delayMs = Number(options.delayMs ?? Number(process.env.SSM_LAUNCH_PROBE_DELAY_MS || 1000));
	let lastResult = null;

	for (let i = 0; i < attempts; i++) {
		try {
			lastResult = await getSSMCommandResult(commandId, instanceId);
		} catch (error) {
			return {
				settled: false,
				probeError: error.message,
				probeAttempts: i + 1,
			};
		}

		if (["Success", "Failed", "Cancelled", "TimedOut", "Cancelling"].includes(lastResult.status)) {
			return {
				settled: true,
				status: lastResult.status,
				exitCode: lastResult.exitCode,
				stdoutPreview: previewText(lastResult.stdout),
				stderrPreview: previewText(lastResult.stderr),
				probeAttempts: i + 1,
			};
		}

		if (i < attempts - 1) {
			await delay(delayMs);
		}
	}

	return {
		settled: false,
		status: lastResult?.status || "Unknown",
		exitCode: lastResult?.exitCode ?? null,
		stdoutPreview: previewText(lastResult?.stdout),
		stderrPreview: previewText(lastResult?.stderr),
		probeAttempts: attempts,
	};
}

// end temp

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	await validateResourceAccess(event, `server::${instanceId}`);

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

	logAction(FUNC_NAMES.SERV_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: "select-world",
		status: 'command-built',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { command }
	});

	// Execute command on EC2 instance via SSM
	// Note: Port forwarding may need to be handled at the security group level
	// or via iptables on the EC2 instance if not already configured
	try {
		const launchedAt = new Date().toISOString();
		const result = await executeSSMCommand(instanceId, [command]);
		const probe = await probeSSMCommandStatus(instanceId, result.commandId);

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
			action: "select-world",
			status: 'ssm-dispatched',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: {
				commandId: result.commandId,
				launchedAt,
				worldFilePath,
				port,
				tshockPath,
				launchCommandPreview: previewText(command, 600),
				probe,
			}
		});

		// await delay(500);
		// const output = await getSSMCommandResult(result.commandId, instanceId);
		return successResponse({
			message: "TShock server starting",
			instanceId,
			commandId: result.commandId,
			worldFile: worldFilePath,
			port,
			// output,
		});
	} catch (error) {
		logAction(FUNC_NAMES.SERV_MGR, {
			userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
			action: "select-world",
			status: 'ssm-dispatch-failed',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: {
				worldFilePath,
				port,
				tshockPath,
				error: error.message,
				launchCommandPreview: previewText(command, 600),
			}
		});
		return validationError(`Failed to execute command: ${error.message}`);
	}
}

module.exports = {handle};
