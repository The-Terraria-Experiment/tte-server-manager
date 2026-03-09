/**
 * Start a tshock server with a selected world
 */

const {successResponse, validationError} = require("../shared/utils/response");
const { executeSSMCommand, getSSMCommandResult, syncInstanceFileToS3 } = require("../shared/utils/aws");
const { getDynamoItem, putDynamoItem, updateDynamoItem } = require("../shared/utils/dynamo");
const path = require("path");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { delay } = require("../shared/utils/delay");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("../shared/constants");
const { validateResourceAccess, getUserSub } = require("../shared/utils/permissions");
const { SYSTEM_TABLE } = require("../shared/vars");

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });


function buildTShockCommand(tshockPath, newWorldConfigPath) {
	// Validate and quote paths to handle spaces safely
	const baseRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	const quotedTshockPath = `"${baseRoot}${tshockPath}"`;
	const escapedConfigPath = newWorldConfigPath.replace(/"/g, '\\"');

	// Build command with flags
	let command = `${quotedTshockPath} -config "${escapedConfigPath}" -autocreate 1`;
	// command += ` -port ${parseInt(port)}`;
	// command += ` -maxplayers ${parseInt(maxPlayers)}`;

	// Only add password flag if provided and non-empty
	// if (password && password.trim()) {
	// 	command += ` -password "${password}"`;
	// }

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

	// Choose launch strategy. systemd-run detaches cleanly from SSM process tracking.
	const launchMode = (process.env.TSHOCK_LAUNCH_MODE || "auto").toLowerCase();

	// Run detached so SSM can exit while server keeps running
	const workingDir = (process.env.TSHOCK_WD || "").replace(/\/$/, "");
	const cdRoot = `cd "${workingDir}"`;
	const legacyDetached = `nohup ${command} < /dev/null & echo "TShock launch dispatched (legacy)"`;
	const legacyLaunch = `runuser -u ubuntu -- /bin/bash -c '${cdRoot} && ${legacyDetached}'`;

	const serviceScript = `${cdRoot} && exec ${command} < /dev/null`;
	const escapedServiceScript = serviceScript.replace(/'/g, `'"'"'`);
	const systemdLaunch = `systemd-run --unit "tshock-$(date +%s)-$$" --uid ubuntu --working-directory "${workingDir}" --collect --quiet /bin/bash -c '${escapedServiceScript}' && echo "TShock launch dispatched (systemd-run)"`;

	if (launchMode === "legacy") {
		return legacyLaunch;
	}

	if (launchMode === "systemd") {
		return `if command -v systemd-run >/dev/null 2>&1; then ${systemdLaunch}; else echo "systemd-run not available" >&2; exit 127; fi`;
	}

	return `if command -v systemd-run >/dev/null 2>&1; then ${systemdLaunch}; else ${legacyLaunch}; fi`;
}

function previewText(value, maxLength = 400) {
	if (!value) {
		return "";
	}
	const text = String(value).trim();
	return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function probeSSMCommandStatus(instanceId, commandId, options = {}) {
	const attempts = Number(options.attempts ?? Number(process.env.SSM_LAUNCH_PROBE_ATTEMPTS || 6));
	const delayMs = Number(options.delayMs ?? Number(process.env.SSM_LAUNCH_PROBE_DELAY_MS || 1500));
	let lastResult = null;
	let lastError = null;
	const statusHistory = [];
	const errorHistory = [];

	for (let i = 0; i < attempts; i++) {
		try {
			lastResult = await getSSMCommandResult(commandId, instanceId);
			lastError = null;
			statusHistory.push(lastResult?.status || "Unknown");
		} catch (error) {
			lastError = error;
			errorHistory.push({
				attempt: i + 1,
				name: error?.name || "Error",
				message: error?.message || "Unknown",
			});
			if (i < attempts - 1) {
				await delay(delayMs);
			}
			continue;
		}

		if (["Success", "Failed", "Cancelled", "TimedOut", "Cancelling"].includes(lastResult.status)) {
			return {
				settled: true,
				status: lastResult.status,
				exitCode: lastResult.exitCode,
				stdoutPreview: previewText(lastResult.stdout),
				stderrPreview: previewText(lastResult.stderr),
				probeAttempts: i + 1,
				statusHistory,
				errorHistory,
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
		probeError: lastError?.message || null,
		probeAttempts: attempts,
		statusHistory,
		errorHistory,
	};
}

function buildNewWorldConfigContent(worldFolderPath, size, difficulty, evil, name, seed, maxPlayers, port, password) {
	const baseRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	const worldPath = path.posix.normalize(`${baseRoot}/${worldFolderPath}`);

	const lines = [
		`worldpath=${worldPath}`,
		`world=${worldPath}/${name}.wld`,
		`worldname=${name}`,
		`maxplayers=${Number(maxPlayers)}`,
		`port=${Number(port)}`,
		// size/difficulty/evil may be off by 1 because WHY FRICKIN NOT HUH THANKS TSHOCK THAT'S NOT CONFUSING AND ENTIRELY UNDOCUMENTED
		`seed=${size}.${difficulty}.${evil - 1}.${seed || Date.now()}`, // compound seed, because that makes sense
	];

	// todo: write password to config

	return lines.join("\n");
}

function buildWriteNewWorldConfigCommand(configPath, content) {
	const escapedConfigPath = configPath.replace(/"/g, '\\"');
	return `cat > "${escapedConfigPath}" <<'__NEW_WORLD_CONFIG__'\n${content}\n__NEW_WORLD_CONFIG__`;
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
	const statCommand = `if [ -f "${escapedPath}" ]; then stat -c %s "${escapedPath}"; else echo "MISSING"; fi`;

	let lastSize = null;
	let stableTicks = 0;

	for (let i = 0; i < attempts; i++) {
		const result = await runSSMCommandAndWait(instanceId, [statCommand], { pollDelayMs: 5000, maxPolls: 25 });
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

function buildJobUid(jobId) {
	return `world-create#${jobId}`;
}

function createJobId() {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeBody(body) {
	return {
		worldFolderPath: body.worldFolderPath,
		port: body.port,
		maxPlayers: body.maxPlayers,
		password: body.password,
		size: body.size,
		difficulty: body.difficulty,
		evil: body.evil,
		seed: body.seed,
		worldName: body.worldName,
	};
}

async function updateWorldCreateJob(jobUid, updates) {
	await updateDynamoItem(SYSTEM_TABLE, jobUid, {
		updates: {
			...updates,
			updatedAt: new Date().toISOString(),
		}
	});
}

async function invokeCreateWorldWorker(payload) {
	const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
	if (!functionName) {
		throw new Error("AWS_LAMBDA_FUNCTION_NAME env var missing");
	}

	await lambdaClient.send(new InvokeCommand({
		FunctionName: functionName,
		InvocationType: "Event",
		Payload: Buffer.from(JSON.stringify(payload)),
	}));
}

function validateCreateWorldInput(body) {
	const {worldFolderPath, port, maxPlayers, password, size, difficulty, evil, seed, worldName} = body;

	if (!worldFolderPath) {
		throw new Error("World file path is required");
	}
	if (!port) {
		throw new Error("Port is required");
	}
	if (!maxPlayers) {
		throw new Error("Max players is required");
	}
	if (!worldName) {
		throw new Error("World name is required");
	}

	if (password && !/^[a-zA-Z0-9_]+$/.test(password)) {
		throw new Error("Password must contain only alphanumeric characters and underscores");
	}

	if (seed && !/^[a-zA-Z0-9_\s]+$/.test(seed)) {
		throw new Error("Seed must contain only alphanumeric characters, underscores, and spaces");
	}

	if (!/^[0-9]+$/.test(port)) {
		throw new Error("Port must contain only numeric characters");
	}

	if (!/^[0-9]+$/.test(maxPlayers)) {
		throw new Error("Max players must contain only numeric characters");
	}

	if (isNaN(Number(size)) || size < 1 || size > 3) {
		throw new Error("Size must be a number between 1 and 3 inclusive");
	}

	if (isNaN(Number(difficulty)) || difficulty < 1 || difficulty > 4) {
		throw new Error("Difficulty must be a number between 1 and 4 inclusive");
	}

	if (isNaN(Number(evil)) || evil < 1 || evil > 3) {
		throw new Error("Evil must be a number between 1 and 3 inclusive");
	}

	if (!/^[a-zA-Z0-9_]+$/.test(worldName)) {
		throw new Error("World name must only include alphanumeric characters and underscores");
	}
}

async function runCreateWorldWorker(workerEvent) {
	const { instanceId, jobUid, requestedBy, body } = workerEvent;
	const {worldFolderPath, port, maxPlayers, password, size, difficulty, evil, seed, worldName} = body;

	const worldsBucket = process.env.S3_FILESTORE_NAME;
	if (!worldsBucket) {
		throw new Error("Worlds S3 bucket not configured (S3_FILESTORE_NAME env var missing)");
	}

	const tshockPath = process.env.TSHOCK_PATH;
	if (!tshockPath) {
		throw new Error("TShock executable path not configured (TSHOCK_PATH env var missing)");
	}

	const instanceData = await getDynamoItem(process.env.INSTANCE_TABLE_NAME, `inst#${instanceId}`);
	const worldPaths = instanceData?.worldPaths || [];

	if (!worldPaths.some(validPath => worldFolderPath === validPath)) {
		throw new Error("World file path does not fall within a designated world files folder");
	}

	const baseRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	const workingDir = (process.env.TSHOCK_WD || "").replace(/\/$/, "") || baseRoot;
	const newWorldConfigPath = path.posix.join(workingDir, "newworldconfig.txt");
	const newWorldConfigContent = buildNewWorldConfigContent(worldFolderPath, size, difficulty, evil, worldName, seed, maxPlayers, port, password);
	const command = buildTShockCommand(tshockPath, newWorldConfigPath);
	const worldFolderNormalized = path.posix.normalize(`${baseRoot}/${worldFolderPath}`);
	const worldFilePath = path.posix.join(worldFolderNormalized, `${worldName}.wld`);
	const s3Key = path.posix.join(instanceId, worldFolderPath, `${worldName}.wld`);

	await updateWorldCreateJob(jobUid, {
		status: "running",
		step: "writing-config",
		message: "Writing world configuration file",
		progress: 10,
		instanceId,
		worldFilePath,
		s3Key,
	});

	const writeConfigCommand = buildWriteNewWorldConfigCommand(newWorldConfigPath, newWorldConfigContent);
	await runSSMCommandAndWait(instanceId, [writeConfigCommand], { pollDelayMs: 1000, maxPolls: 30 });

	await updateWorldCreateJob(jobUid, {
		step: "starting-tshock",
		message: "Launching TShock world generation",
		progress: 25,
	});

	const launchedAt = new Date().toISOString();
	const result = await executeSSMCommand(instanceId, [command]);
	const launchProbe = await probeSSMCommandStatus(instanceId, result.commandId);

	logAction(FUNC_NAMES.SERV_MGR, {
		userId: requestedBy ?? 'unknown',
		action: "create-world-worker",
		status: 'tshock-dispatched',
		resource: `internal:create-world-worker:${instanceId}`,
		details: {
			commandId: result.commandId,
			launchedAt,
			worldFilePath,
			port,
			tshockPath,
			launchCommandPreview: previewText(command, 600),
			launchProbe,
		}
	});

	await updateWorldCreateJob(jobUid, {
		step: "waiting-for-world-file",
		message: "Building world file",
		progress: 45,
		commandId: result.commandId,
		launchProbeStatus: launchProbe.status || (launchProbe.settled ? "Unknown" : "InProgress"),
		launchProbeSettled: Boolean(launchProbe.settled),
		launchProbeError: launchProbe.probeError || null,
	});

	const pollAttempts = Number(process.env.WORLD_CREATE_POLL_ATTEMPTS || 30);
	const pollDelayMs = Number(process.env.WORLD_CREATE_POLL_DELAY_MS || 5000);
	const stableCount = Number(process.env.WORLD_CREATE_STABLE_COUNT || 2);

	await waitForWorldFileReady(instanceId, worldFilePath, {
		attempts: pollAttempts,
		delayMs: pollDelayMs,
		stableCount,
	});

	await updateWorldCreateJob(jobUid, {
		step: "uploading-world",
		message: "Uploading created world file to S3",
		progress: 75,
	});

	const upload = await syncInstanceFileToS3(instanceId, worldFilePath, worldsBucket, s3Key);
	await waitForSSMCommand(instanceId, upload.commandId, { pollDelayMs: 1000, maxPolls: 60 });

	await updateWorldCreateJob(jobUid, {
		status: "completed",
		step: "done",
		message: "World created and uploaded successfully",
		progress: 100,
		uploadCommandId: upload.commandId,
		finishedAt: new Date().toISOString(),
	});

	return {
		commandId: result.commandId,
		uploadCommandId: upload.commandId,
		worldFilePath,
		s3Key,
	};
}

async function handle(event) {
	if (event?.internalAction === "create-world-worker") {
		try {
			await runCreateWorldWorker(event);
			return { ok: true };
		} catch (error) {
			if (event?.jobUid) {
				await updateWorldCreateJob(event.jobUid, {
					status: "failed",
					step: "failed",
					message: error.message || "World creation failed",
					error: error.message || "World creation failed",
					finishedAt: new Date().toISOString(),
				});
			}

			logAction(FUNC_NAMES.SERV_MGR, {
				userId: event?.requestedBy ?? 'unknown',
				action: "create-world-worker",
				status: 'failed',
				resource: `internal:create-world-worker:${event?.instanceId ?? 'unknown'}`,
				details: { error: error.message }
			});

			return { ok: false, error: error.message };
		}
	}

	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	await validateResourceAccess(event, `server::${instanceId}`);
	const requestedBy = getUserSub(event) || event.requestContext?.authorizer?.claims?.sub || null;

	// Extract body parameters
	const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;

	try {
		validateCreateWorldInput(body);

		const jobId = createJobId();
		const jobUid = buildJobUid(jobId);
		const createdAt = new Date().toISOString();

		await putDynamoItem(SYSTEM_TABLE, {
			uid: jobUid,
			type: "world-create-job",
			instanceId,
			requestedBy,
			status: "queued",
			step: "queued",
			message: "World creation job queued",
			progress: 0,
			createdAt,
			updatedAt: createdAt,
			request: normalizeBody(body),
		});

		await invokeCreateWorldWorker({
			internalAction: "create-world-worker",
			jobUid,
			instanceId,
			requestedBy,
			body: normalizeBody(body),
		});

		logAction(FUNC_NAMES.SERV_MGR, {
			userId: requestedBy ?? 'unknown',
			action: "create-world",
			status: 'queued',
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: { jobId, jobUid, instanceId }
		});

		return successResponse({
			message: "World creation started",
			instanceId,
			jobId,
			jobUid,
			status: "queued",
			statusEndpoint: `/server/${instanceId}/world/create/${jobId}/status`,
			progressMessage: "World creation job queued",
		});
	} catch (error) {
		return validationError(`Failed to queue world creation: ${error.message}`);
	}
}

module.exports = {handle};
