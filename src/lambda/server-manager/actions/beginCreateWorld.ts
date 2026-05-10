import type { InstanceDataEntry } from "../shared/schema/InstanceTable.js";
import type { NewWorldRequestData, NewWorldRequestParams } from "../index.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Assert } from "../shared/utils/Assert.js";
import path from "path";
import { SYSTEM_TABLE, WORLD_CREATE_KEY } from "../shared/vars.js";
import type { SystemWorldCreateEntry } from "../shared/schema/SystemTable.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Delay } from "../shared/utils/Delay.js";
import { S3Dao } from "../shared/aws/S3.js";

const buildCreateWorldTShockCommand = (params: NewWorldRequestParams, worldFilePath: string): string => {
	// Validate and quote paths to handle spaces safely
	const fsRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	const quotedTshockPath = `"${fsRoot}${process.env.TSHOCK_PATH}"`;
	const escapedWorldPath = worldFilePath.replace(/"/g, '\\"');

	const evilMap: Record<number, string> = {
		1: "random",
		2: "corrupt",
		3: "crimson"
	};
	
	// TShock worldgen args are order-sensitive
	let command = `${quotedTshockPath} -autocreate ${params.size} -world "${escapedWorldPath}" -difficulty ${params.difficulty - 1} -worldevil ${evilMap[params.evil]}`;
	
	if (params.seed) {
		const escapedSeed = params.seed.replace(/"/g, '\\"');
		command += ` -seed "${escapedSeed}"`;
	}
	command += ` -port ${params.port} -maxplayers ${params.maxPlayers}`;
	if (params.password) {
		const escapedPassword = params.password.replace(/"/g, '\\"');
		command += ` -password "${escapedPassword}"`;
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

	// Build command
	const workingDir = (process.env.TSHOCK_WD || "").replace(/\/$/, "");
	Assert.IsTruthyString(workingDir, "TShock working directory not configured (TSHOCK_WD env var missing)");
	const cdRoot = `cd "${workingDir}"`;

	const serviceScript = `${cdRoot} && exec ${command} < /dev/null`;
	const escapedServiceScript = serviceScript.replace(/'/g, `'"'"'`);
	// Using systemd so that SSM can detach and TShock continues running headless indefinitely
	const systemdLaunch = `systemd-run --unit "tshock-$(date +%s)-$$" --uid ubuntu --working-directory "${workingDir}" --collect --quiet /bin/bash -c '${escapedServiceScript}' && echo "TShock launch dispatched"`;

	return systemdLaunch;
};

const waitForWorldFileReady = async (filePath: string, instanceID: string) => {
	const pollAttempts = Number(process.env.WORLD_CREATE_POLL_ATTEMPTS || 30);
	const pollDelayMs = Number(process.env.WORLD_CREATE_POLL_DELAY_MS || 5000);
	const stableCount = Number(process.env.WORLD_CREATE_STABLE_COUNT || 2);
	const escapedPath = filePath.replace(/"/g, '\\"');
	const statCommand = `if [ -f "${escapedPath}" ]; then stat -c %s "${escapedPath}"; else echo "MISSING"; fi`;

	const SSM = new SsmDao();

	let lastSize = null;
	let stableTicks = 0;

	for (let i = 0; i < pollAttempts; i++) {
		const result = await SSM.ExecuteCommandGetResult(instanceID, [statCommand], 5000);
		const output = (result.stdout || "").trim();

		if (!output || output === "MISSING") {
			stableTicks = 0;
			await new Delay(pollDelayMs);
			continue;
		}

		const size = Number(output);
		if (!Number.isFinite(size) || size <= 0) {
			stableTicks = 0;
			await new Delay(pollDelayMs);
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

		await new Delay(pollDelayMs);
	}

	throw new Error("World file did not become ready in time");
};

export const beginCreateWorld = async (params: NewWorldRequestData) => {
	CWLogger.CAction(3, FUNC_NAMES.SERV_MGR, {
		userId: params.requestedBy,
		action: "create-world",
		status: "begin",
		details: {}
	});

	const worldsBucket = process.env.S3_FILESTORE_NAME;
	const tshockPath = process.env.TSHOCK_PATH;
	Assert.IsTruthyString(worldsBucket, "Worlds S3 bucket not configured (S3_FILESTORE_NAME env var missing)");
	Assert.IsTruthyString(tshockPath, "TShock executable path not configured (TSHOCK_PATH env var missing)");

	const DB = new DynamoDao();

	const instanceTable = process.env.INSTANCE_TABLE_NAME;
	Assert.IsTruthyString(instanceTable, "Instance table name not configured (INSTANCE_TABLE_NAME env var missing)");
	const instanceData = await DB.GetItem(instanceTable!, `inst#${params.instanceID}`) as InstanceDataEntry;
	const worldPaths = instanceData?.worldPaths || [];

	if (!worldPaths.some(validPath => params.params.worldFolderPath === validPath)) {
		return ResponseUtil.ValidationError("World file path is unauthorized");
	}

	const fsRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	Assert.IsTruthyString(fsRoot, "Filesystem root not configured (BASE_ROOT env var missing)");

	CWLogger.CAction(4, FUNC_NAMES.SERV_MGR, {
		userId: params.requestedBy,
		action: "create-world",
		status: "initial-data-collected",
		details: {}
	});

	const worldFolderNormalized = path.posix.normalize(`${fsRoot}/${params.params.worldFolderPath}`);
	const worldFilePath = path.posix.join(worldFolderNormalized, `${params.params.worldName}.wld`);
	const command = buildCreateWorldTShockCommand(params.params, worldFilePath);
	const s3Key = path.posix.join(params.instanceID, params.params.worldFolderPath, `${params.params.worldName}.wld`);

	const creationUpdate1: SystemWorldCreateEntry = {
		status: "running",
		step: "starting-tshock",
		progress: 20,
		updatedAt: new Date().toISOString()
	};
	await DB.UpdateItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${params.instanceID}`, {
		updates: creationUpdate1
	});

	const SSM = new SsmDao();
	const tshockResult = await SSM.ExecuteCommand(params.instanceID, [command]);

	CWLogger.CAction(3, FUNC_NAMES.SERV_MGR, {
		userId: params.requestedBy,
		action: "create-world",
		status: "command-dispatched",
		details: {
			commandID: tshockResult.commandId,
			worldFilePath,
			params: params.params
		}
	});

	const creationUpdate2: SystemWorldCreateEntry = {
		step: "waiting-for-world-file",
		progress: 45,
		updatedAt: new Date().toISOString()
	};
	await DB.UpdateItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${params.instanceID}`, {
		updates: creationUpdate2
	});
	
	await waitForWorldFileReady(worldFilePath, params.instanceID);

	const creationUpdate3: SystemWorldCreateEntry = {
		step: "uploading-world-file",
		progress: 85,
		updatedAt: new Date().toISOString()
	};
	await DB.UpdateItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${params.instanceID}`, {
		updates: creationUpdate3
	});

	CWLogger.CAction(3, FUNC_NAMES.SERV_MGR, {
		userId: params.requestedBy,
		action: "create-world",
		status: "uploading-world",
		details: {
			worldFilePath,
			params: params.params
		}
	});

	const S3 = new S3Dao();

	const upload = await S3.SyncInstanceFileToS3(params.instanceID, worldFilePath, worldsBucket!, s3Key);
	await SSM.PollForCommandCompletion(upload.commandId, params.instanceID);

	const creationUpdate4: SystemWorldCreateEntry = {
		status: "completed",
		step: "completed",
		progress: 100,
		updatedAt: new Date().toISOString()
	};
	await DB.UpdateItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${params.instanceID}`, {
		updates: creationUpdate4
	});

	CWLogger.CAction(3, FUNC_NAMES.SERV_MGR, {
		userId: params.requestedBy,
		action: "create-world",
		status: "creation-complete",
		details: {
			createCommand: tshockResult.commandId,
			uploadCommand: upload.commandId,
			worldFilePath,
			params,
			s3Key
		}
	});

	// Give time for the front-end to pick up the "completed entry" 
	// (currently polls every 5s, so a little more than 2 poll cycles should be enough)
	await new Delay(12000);

	const success = await DB.DeleteItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${params.instanceID}`);
	if (!success) {
		return ResponseUtil.Error("Clean-up failed");
	}

	return ResponseUtil.Success({ ok: true });
};
