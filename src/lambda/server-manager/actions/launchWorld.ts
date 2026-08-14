import type { Context } from "vm";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Assert } from "../shared/utils/core/Assert.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import type { InstanceDataEntry } from "../shared/schema/InstanceTable.js";
import path from "path";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { applyServerPasswordToConfig } from "../shared/utils/tshock/TShockConfig.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import { ensureLogDirsCommand, joinLaunchSteps, tshockProcessPattern } from "../shared/utils/tshock/TShockLaunch.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import { beginServerSession } from "../shared/utils/tshock/ServerSession.js";
import { Realtime } from "../shared/utils/realtime/RealtimePublisher.js";

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

const buildLaunchWorldTShockCommand = (worldPath: string, port: number, maxPlayers: number): string => {
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

	// NOTE: The server password is intentionally NOT passed on the command line. TShock has no
	// -password/-pass switch and ignores the vanilla one entirely — the only thing that sets
	// Netplay.ServerPassword under TShock is the interactive prompt, so a CLI password is silently
	// dropped and config.json wins. We instead write ServerPassword into config.json before launch
	// (see applyServerPasswordToConfig).

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

	const serviceScript = joinLaunchSteps(cdRoot, ensureLogDirsCommand(), `exec ${command} < /dev/null`);
	const escapedServiceScript = serviceScript.replace(/'/g, `'"'"'`);
	const systemdLaunch = `systemd-run --unit "tshock-$(date +%s)-$$" --uid ubuntu --working-directory "${workingDir}" --collect --quiet /bin/bash -c '${escapedServiceScript}' && echo "TShock launch dispatched"`;

	return systemdLaunch;
};

const buildPreLaunchGuardPath = (): string => {
	const tshockPath = process.env.TSHOCK_PATH;
	Assert.IsTruthyString(tshockPath, "TShock executable path not configured (TSHOCK_PATH env var missing)");
	const searchPattern = tshockProcessPattern();

	return `if pgrep -af '${searchPattern}' >/dev/null 2>&1; then echo 'TSHOCK_ALREADY_RUNNING'; else echo 'TSHOCK_CLEAR_TO_START'; fi`;
};

export const launchWorld = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceID = event.pathParameters?.id;

	if (!instanceID) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${instanceID}`);

	const blocked = await blockIfShutdownInProgress(instanceID);
	if (blocked) return blocked;

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

	const EC2 = new Ec2Dao();
	const SSM = new SsmDao();
	const status = await EC2.GetInstanceStatus(instanceID);
	if (status.state === InstanceState.STOPPED) {
		await EC2.StartInstanceAndAwait(instanceID);
		const ssmOK = await SSM.WaitForInstanceSsm(instanceID);
		if (!ssmOK) {
			throw new Error("SSM did not become ready");
		}
	} else if (
		status.state === InstanceState.PENDING ||
		status.state === InstanceState.SHUTDOWN ||
		status.state === InstanceState.TERMINATED ||
		status.state === InstanceState.STOPPING
	) {
		// We'll allow unknown, cause maybe that's ok. If not, the SSM will error out
		return ResponseUtil.ValidationError("Instance is not running");
	}

	const launchCommand = buildLaunchWorldTShockCommand(worldFilePath, port, maxPlayers);
	const launchGuardCommand = buildPreLaunchGuardPath();

	// Never log the plaintext password to CloudWatch.
	const loggableParams = { ...(event.parsedBody || {}), password: password ? "[redacted]" : "" };

	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "select-world",
		status: "commands-built",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: {
			params: loggableParams
		}
	});

	try {
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

		// Apply the launch password by overriding config.json before starting (TShock ignores CLI passwords).
		if (password && String(password).trim()) {
			await applyServerPasswordToConfig(instanceID, String(password));
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

		await DB.UpdateItem(SYSTEM_TABLE, `autoshutoff#${instanceID}`, {
			updates: {
				serverId: instanceID,
				serverStartedAt: Date.now(),
				lastUpdatedAt: Date.now(),
			},
		});

		// The authoritative session mint. This is the only place that knows the real start time, the
		// world, and who asked — everything else can at best infer a session after the fact from a
		// side effect. Anything that needs to say "which run of the server was this" keys off it.
		await beginServerSession(instanceID, {
			startedBy: Parsers.GetUserSub(event) ?? "",
			source: "launch",
			worldFilePath,
			port: Number(port),
			maxPlayers: Number(maxPlayers),
		});

		// The launch is dispatched, not finished — systemd-run reports success as soon as the unit starts.
		// So this tells other operators the server is coming up; their own poller observes it arriving.
		await Realtime.PublishServerState(instanceID, "launching");

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
				params: loggableParams
			}
		});

		return ResponseUtil.Error("Failed to launch world");
	}
}