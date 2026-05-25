import type { Context } from "vm";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Assert } from "../shared/utils/Assert.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import type { InstanceDataEntry } from "../shared/schema/InstanceTable.js";
import path from "path";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { TShockAPI } from "../utils/TShockAPI.js";

const validateLaunchParams = (body: Record<PropertyKey, any>) => {
	const { worldFilePath, port, maxPlayers, password } = body;
	
	if (!worldFilePath) {
		throw new Error("World file path is required");
	}

	if (password && !/^[a-zA-Z0-9_\s+]+$/.test(password)) {
		throw new Error("Password must contain only alphanumeric characters, underscores, and whitespace");
	}

	if (!/^[0-9]+$/.test(port)) {
		throw new Error("Port must contain only numeric characters");
	}

	if (!/^[0-9]+$/.test(maxPlayers)) {
		throw new Error("Max players must contain only numeric characters");
	}
};

const buildLaunchWorldTShockCommand = (worldPath: string, port: number, maxPlayers: number, password: string | undefined): string => {
	const tshockPath = process.env.TSHOCK_PATH;
	const fsRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	Assert.IsTruthyString(tshockPath, "TShock executable path not configured (TSHOCK_PATH env var missing)");
	Assert.IsTruthyString(fsRoot, "Filesystem root not configured (BASE_ROOT env var missing)");

	const quotedTshockPath = `"${fsRoot}${tshockPath}"`;
	const worldPathNormalized = path.posix.normalize(`${fsRoot}${worldPath}`);
	const escapedPath = worldPathNormalized.replace(/"/g, '\\"');
	const quotedWorldPath = `"${escapedPath}"`;

	let command = `${quotedTshockPath} -world ${quotedWorldPath}`;
	command += ` -port ${port}`;
	command += ` -maxplayers ${maxPlayers}`;

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
	Assert.IsTruthyString(workingDir, "TShock working directory not configured (TSHOCK_WD env var missing)");
	const cdRoot = `cd "${workingDir}"`;

	const serviceScript = `${cdRoot} && exec ${command} < /dev/null`;
	const escapedServiceScript = serviceScript.replace(/'/g, `'"'"'`);
	const systemdLaunch = `systemd-run --unit "tshock-$(date +%s)-$$" --uid ubuntu --working-directory "${workingDir}" --collect --quiet /bin/bash -c '${escapedServiceScript}' && echo "TShock launch dispatched"`;

	return systemdLaunch;
};

const buildPreLaunchGuardPath = (): string => {
	const tshockPath = process.env.TSHOCK_PATH;
	Assert.IsTruthyString(tshockPath, "TShock executable path not configured (TSHOCK_PATH env var missing)");
	const normalizedPath = String(tshockPath || "").trim();
	const binaryName = path.posix.basename(normalizedPath).replace(/[^a-zA-Z0-9._-]/g, "");
	const searchPattern = ["TerrariaServer", "TShock", binaryName].filter(Boolean).join("|");

	return `if pgrep -af '${searchPattern}' >/dev/null 2>&1; then echo 'TSHOCK_ALREADY_RUNNING'; else echo 'TSHOCK_CLEAR_TO_START'; fi`;
};

export const launchWorld = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceID = event.pathParameters?.id;

	if (!instanceID) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${instanceID}`);

	try {
		validateLaunchParams(event.parsedBody || {});
	} catch (e: any) {
		return ResponseUtil.ValidationError("Invalid launch params: " + (e.message ?? "unknown"));
	}
	const { worldFilePath, port, maxPlayers, password } = (event.parsedBody || {});

	const instanceTable = process.env.INSTANCE_TABLE_NAME;
	Assert.IsTruthyString(instanceTable, "Instance table name not configured (INSTANCE_TABLE_NAME env var missing)");

	const DB = new DynamoDao();

	const instanceData = await DB.GetItem(instanceTable!, `inst#${instanceID}`) as InstanceDataEntry;
	const worldPathNicknames = instanceData.worldPaths || [];
	const validRoots = instanceData.validRoots || {};

	// Find the matching path nickname for the world file
	let matchingNickname: string | null = null;
	for (const nickname of worldPathNicknames) {
		const resolvedPath = validRoots[nickname];
		if (resolvedPath && worldFilePath.startsWith(`${resolvedPath}/`)) {
			matchingNickname = nickname;
			break;
		}
	}

	if (!matchingNickname) {
		return ResponseUtil.ValidationError("File path does not fall within a designated world files folder");
	}

	// Validate user has access to this specific path
	await Permissions.ValidateResourceAccess(event, `filepath::${instanceID}::${matchingNickname}`);

	const launchCommand = buildLaunchWorldTShockCommand(worldFilePath, port, maxPlayers, password);
	const launchGuardCommand = buildPreLaunchGuardPath();

	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "select-world",
		status: "commands-built",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: {
			params: event.parsedBody
		}
	});

	try {
		const SSM = new SsmDao();

		const guardResult = await SSM.ExecuteCommandGetResult(instanceID, [launchGuardCommand]);
		const guardOutput = (guardResult.stdout || "").trim();

		if (guardOutput.includes("TSHOCK_ALREADY_RUNNING")) {
			CWLogger.Action(FUNC_NAMES.SERV_MGR, {
				userId: Parsers.GetUserSub(event),
				action: "select-world",
				status: "launch-guard-blocked",
				resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
				details: {
					instanceID,
					commandID: guardResult.commandID,
					guardOutput
				}
			});

			return ResponseUtil.ValidationError("A TShock process is already running on this instance.");
		}

		const result = await SSM.ExecuteCommand(instanceID, [launchCommand]);

		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "select-world",
			status: "launch-dispatched",
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: {
				commandID: result.commandId,
				worldFilePath,
				port
			}
		});

		// Clear out stale tokens
		TShockAPI.DropTokenCache();

		return ResponseUtil.Success({
			message: " TShock server starting",
		});
	} catch (e: any) {
		CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "select-world",
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			error: e?.message || "",
			stack: new Error().stack,
			details: {
				instanceID,
				params: event.parsedBody
			}
		});

		return ResponseUtil.Error("Failed to launch world");
	}
}