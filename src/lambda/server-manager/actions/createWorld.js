/**
 * Start a tshock server with a selected world
 */

const {successResponse, validationError} = require("../shared/utils/response");
const { executeSSMCommand, getSSMCommandResult, syncInstanceFileToS3 } = require("../shared/utils/aws");
const { getDynamoItem } = require("../shared/utils/dynamo");
const path = require("path");
const { delay } = require("../shared/utils/delay");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("../shared/constants");
const { validateResourceAccess } = require("../shared/utils/permissions");


function buildTShockCommand(tshockPath, worldFolderPath, size, difficulty, evil, name, seed, maxPlayers, port, password) {
	// Validate and quote paths to handle spaces safely
	const baseRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	const quotedTshockPath = `"${baseRoot}${tshockPath}"`;
	const worldPathNormalized = path.posix.normalize(`${baseRoot}${worldFolderPath}`);
	const escapedPath = worldPathNormalized.replace(/"/g, '\\"');
	const quotedWorldPath = `"${escapedPath}"`;

	// Build command with flags
	let command = `${quotedTshockPath} -worldselectpath ${quotedWorldPath}`;
	// command += ` -port ${parseInt(port)}`;
	// command += ` -maxplayers ${parseInt(maxPlayers)}`;

	// Only add password flag if provided and non-empty
	// if (password && password.trim()) {
	// 	command += ` -password "${password}"`;
	// }

	const input = `n${size}\n${difficulty}\n${evil}\n${name}\n${seed}\n1\n${maxPlayers}\n${port}\ny\n\n`;

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
	command = `printf '${input}' | ${command}`;
	const detached = `nohup ${command} < /dev/null & disown`;
	return `runuser -u ubuntu -- /bin/bash -lc "${cdRoot} && ${detached}"`;
}

async function waitForSSMCommand(instanceId, commandId, options = {}) {
	const pollDelayMs = Number(options.pollDelayMs ?? 1000);
	const maxPolls = Number(options.maxPolls ?? 30);

	for (let i = 0; i < maxPolls; i++) {
		await delay(pollDelayMs);
		const result = await getSSMCommandResult(commandId, instanceId);
		if (result.status === "Success") {
			return result;
		}
		if (["Failed", "Cancelled", "TimedOut", "Cancelling"].includes(result.status)) {
			throw new Error(`SSM command ${commandId} ${result.status}: ${result.stderr || result.stdout}`);
		}
	}

	throw new Error(`SSM command ${commandId} timed out`);
}

async function runSSMCommandAndWait(instanceId, commands, options = {}) {
	const { commandId } = await executeSSMCommand(instanceId, commands);
	return waitForSSMCommand(instanceId, commandId, options);
}

async function waitForWorldFileReady(instanceId, filePath, options = {}) {
	const attempts = Number(options.attempts ?? 30);
	const delayMs = Number(options.delayMs ?? 5000);
	const stableCount = Number(options.stableCount ?? 2);
	const escapedPath = filePath.replace(/"/g, '\\"');
	const statCommand = `if [ -f "${escapedPath}" ]; then stat -c %s "${escapedPath}"; else echo MISSING; exit 2; fi`;

	let lastSize = null;
	let stableTicks = 0;

	for (let i = 0; i < attempts; i++) {
		const result = await runSSMCommandAndWait(instanceId, [statCommand], { pollDelayMs: 1000, maxPolls: 20 });
		const output = (result.stdout || "").trim();
		if (!output || output === "MISSING") {
			stableTicks = 0;
			await delay(delayMs);
			continue;
		}

		const size = Number(output);
		if (!Number.isFinite(size) || size <= 0) {
			stableTicks = 0;
			await delay(delayMs);
			continue;
		}

		if (lastSize !== null && size === lastSize) {
			stableTicks += 1;
			if (stableTicks >= stableCount) {
				return { size };
			}
		} else {
			stableTicks = 0;
			lastSize = size;
		}

		await delay(delayMs);
	}

	throw new Error("World file did not become ready in time");
}

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	await validateResourceAccess(event, `server::${instanceId}`);

	// Extract body parameters
	const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
	const {worldFolderPath, port, maxPlayers, password, size, difficulty, evil, seed, worldName} = body;

	// Validate required parameters
	if (!worldFolderPath) {
		return validationError("World file path is required");
	}
	if (!port) {
		return validationError("Port is required");
	}
	if (!maxPlayers) {
		return validationError("Max players is required");
	}
	if (!worldName) {
		return validationError("World name is required");
	}

	const worldsBucket = process.env.S3_FILESTORE_NAME;
	if (!worldsBucket) {
		return validationError("Worlds S3 bucket not configured (S3_FILESTORE_NAME env var missing)");
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

	if (isNaN(Number(size)) || size < 1 || size > 3) {
		return validationError("Size must be a number between 1 and 3 inclusive");
	}

	if (isNaN(Number(difficulty)) || difficulty < 1 || difficulty > 4) {
		return validationError("Difficulty must be a number between 1 and 4 inclusive");
	}

	if (isNaN(Number(evil)) || evil < 1 || evil > 3) {
		return validationError("Evil must be a number between 1 and 3 inclusive");
	}

	if (isNaN(Number(seed))) {
		return validationError("Seed must be a number");
	}

	if (!/^[0-9]+$/.test(worldName)) {
		return validationError("World name must only unclude alphanumeric characters and underscores");
	}

	const instanceData = await getDynamoItem(process.env.INSTANCE_TABLE_NAME, `inst#${instanceId}`);
	const worldPaths = instanceData?.worldPaths || [];

	if (!worldPaths.some(validPath => worldFolderPath === validPath)) {
		return validationError("World file path does not fall within a designated world files folder");
	}

	// Build the command
	const command = buildTShockCommand(tshockPath, worldFolderPath, size, difficulty, evil, worldName, seed, maxPlayers, port, password);
	const baseRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	const worldFolderNormalized = path.posix.normalize(`${baseRoot}/${worldFolderPath}`);
	const worldFilePath = path.posix.join(worldFolderNormalized, `${worldName}.wld`);
	const s3Key = path.posix.join(instanceId, worldFolderPath, `${worldName}.wld`);

	logAction(FUNC_NAMES.SERV_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: "create-world",
		status: 'command-built',
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { command }
	});

	// Execute command on EC2 instance via SSM
	// Note: Port forwarding may need to be handled at the security group level
	// or via iptables on the EC2 instance if not already configured
	try {
		const result = await executeSSMCommand(instanceId, [command]);

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
			action: "select-world",
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { commandId: result.commandId, worldFilePath, port, tshockPath }
		});

		const pollAttempts = Number(process.env.WORLD_CREATE_POLL_ATTEMPTS || 30);
		const pollDelayMs = Number(process.env.WORLD_CREATE_POLL_DELAY_MS || 5000);
		const stableCount = Number(process.env.WORLD_CREATE_STABLE_COUNT || 2);

		await waitForWorldFileReady(instanceId, worldFilePath, {
			attempts: pollAttempts,
			delayMs: pollDelayMs,
			stableCount,
		});

		const upload = await syncInstanceFileToS3(instanceId, worldFilePath, worldsBucket, s3Key);
		await waitForSSMCommand(instanceId, upload.commandId, { pollDelayMs: 1000, maxPolls: 60 });

		// await delay(500);
		// const output = await getSSMCommandResult(result.commandId, instanceId);
		return successResponse({
			message: "TShock server starting (world uploaded)",
			instanceId,
			commandId: result.commandId,
			worldFilePath,
			s3Key,
		});
	} catch (error) {
		return validationError(`Failed to execute command: ${error.message}`);
	}
}

module.exports = {handle};
