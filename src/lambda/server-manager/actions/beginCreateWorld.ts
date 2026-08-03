import type { Context } from "aws-lambda";
import type { InstanceDataEntry } from "../shared/schema/InstanceTable.js";
import type { NewWorldRequestData, NewWorldRequestParams } from "../index.js";
import { boundedWaitDeadline } from "../shared/utils/SyncBudget.js";
import { ensureLogDirsCommand, joinLaunchSteps } from "../shared/utils/TShockLaunch.js";
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
import { TShockAPI } from "../shared/utils/TShockAPI.js";
import { applyServerPasswordToConfig } from "../shared/utils/TShockConfig.js";

/**
 * Resolves the daily TShock stdout log path (BASE-agnostic; matches the redirect target used when
 * launching worldgen). Returns null when stdout logging isn't configured, in which case worldgen
 * output is dropped to /dev/null and no live status can be read.
 */
const resolveOutLogPath = (): string | null => {
	const outLogRoot = (process.env.TSHOCK_OUT_LOGS || "").trim().replace(/\/$/, "");
	if (!outLogRoot) return null;
	return path.posix.join(outLogRoot, `${new Date().toISOString().slice(0, 10)}.log`);
};

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

	// NOTE: The server password is intentionally NOT passed on the command line. TShock has no
	// -password/-pass switch and ignores the vanilla one, so a CLI password is silently dropped and
	// config.json wins. The `-autocreate` run generates the world and then keeps serving it, so the
	// live server's password is written into config.json before launch (see applyServerPasswordToConfig).

	// Append stdout redirection into daily log file when configured (otherwise drop to /dev/null)
	const outLogPath = resolveOutLogPath();
	if (outLogPath) {
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

	const serviceScript = joinLaunchSteps(cdRoot, ensureLogDirsCommand(), `exec ${command} < /dev/null`);
	const escapedServiceScript = serviceScript.replace(/'/g, `'"'"'`);
	// Using systemd so that SSM can detach and TShock continues running headless indefinitely
	const systemdLaunch = `systemd-run --unit "tshock-$(date +%s)-$$" --uid ubuntu --working-directory "${workingDir}" --collect --quiet /bin/bash -c '${escapedServiceScript}' && echo "TShock launch dispatched"`;

	return systemdLaunch;
};

/**
 * Terraria's live worldgen status lines always contain an "-ing" verb ("Growing trees",
 * "Settling liquids", "Generating structures", …) or the word "clean" ("Cleaning up world").
 * Early in a run the log tail can instead catch unrelated TShock startup output, so we only
 * surface lines matching this shape as worldgen statuses and ignore everything else.
 */
const isWorldgenStatusLine = (line: string): boolean => {
	return /\w+ing\b/i.test(line) || /clean/i.test(line);
};

/**
 * Polls the world file until its size stabilizes (worldgen finished writing). When an stdout log
 * path is provided, the same SSM round-trip also tails the log's latest non-blank line — Terraria's
 * live worldgen status ("Growing trees", "Settling liquids", …) — and hands each poll to onPoll so
 * callers can heartbeat the job and surface real progress. onPoll is best-effort: its failures are
 * swallowed and never abort the wait.
 *
 * The wait is bounded by `deadline` rather than by a poll count. Each iteration costs an SSM
 * round-trip plus the poll delay (~10s together), so the old fixed 30 attempts budgeted almost
 * exactly the lambda's own 300s timeout: the loop could never finish and report a failure, because
 * the invocation was killed first — leaving the job row stuck on "waiting-for-world-file" forever
 * with no worker left alive to move it. Giving up before the invocation dies is the entire point.
 */
const waitForWorldFileReady = async (
	filePath: string,
	instanceID: string,
	outLogPath: string | null,
	deadline: number,
	onPoll?: (line: string | null) => Promise<void>,
) => {
	const pollDelayMs = Number(process.env.WORLD_CREATE_POLL_DELAY_MS || 5000);
	const stableCount = Number(process.env.WORLD_CREATE_STABLE_COUNT || 2);
	const escapedPath = filePath.replace(/"/g, '\\"');
	const statBlock = `if [ -f "${escapedPath}" ]; then stat -c %s "${escapedPath}"; else echo "MISSING"; fi`;

	// When logging is configured, append the log's last non-blank line after a delimiter. Carriage
	// returns are normalized to newlines first because Terraria rewrites in-place progress with \r,
	// so the freshest status is the final segment rather than the final newline-terminated line.
	const LOG_DELIM = "===WORLDGEN-LOGLINE===";
	let tailBlock = "";
	if (outLogPath && onPoll) {
		const escapedLogPath = outLogPath.replace(/"/g, '\\"');
		tailBlock = `if [ -f "${escapedLogPath}" ]; then tail -c 8192 "${escapedLogPath}" | tr '\\r' '\\n' | grep -av '^[[:space:]]*$' | tail -n 1; fi`;
	}
	const statCommand = tailBlock
		? `${statBlock}; printf '%s\\n' "${LOG_DELIM}"; ${tailBlock}`
		: statBlock;

	const SSM = new SsmDao();

	let lastSize = null;
	let stableTicks = 0;
	let lastLogLine = "";
	let everSawFile = false;

	while (Date.now() < deadline) {
		const result = await SSM.ExecuteCommandGetResult(instanceID, [statCommand], 5000);
		const rawOutput = result.stdout || "";

		let sizeOutput = rawOutput;
		let freshLine: string | null = null;
		if (tailBlock && onPoll) {
			const delimIdx = rawOutput.indexOf(LOG_DELIM);
			if (delimIdx !== -1) {
				sizeOutput = rawOutput.slice(0, delimIdx);
				const logLine = rawOutput.slice(delimIdx + LOG_DELIM.length).trim();
				if (logLine && logLine !== lastLogLine && isWorldgenStatusLine(logLine)) {
					lastLogLine = logLine;
					freshLine = logLine;
				}
			}
		}

		// Every poll heartbeats, not just the ones carrying a new status line. A run where TShock
		// never starts produces no log lines at all, and without a heartbeat that job is
		// indistinguishable from one whose worker has died — which is what decides whether a later
		// request gets to replace it. See WorldgenJob.
		if (onPoll) {
			try {
				await onPoll(freshLine);
			} catch {
				// Reporting progress is best-effort; never let it abort the wait.
			}
		}

		const output = sizeOutput.trim();

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

		everSawFile = true;

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

	// Two very different failures land here, and the difference is the whole diagnosis: a file that
	// never appeared means TShock never got as far as writing one (bad path, failed launch, missing
	// runtime), while a file still growing means worldgen was simply slower than the invocation.
	if (!everSawFile) {
		throw new Error(
			`TShock never created the world file at ${filePath} — the server likely failed to start.` +
			(lastLogLine ? ` Last console output: ${lastLogLine}` : " No console output was produced."),
		);
	}

	throw new Error(
		`World file at ${filePath} was still being written when time ran out (last size ${lastSize} bytes).` +
		(lastLogLine ? ` Last console output: ${lastLogLine}` : ""),
	);
};

/**
 * Wall-clock room the worker keeps for everything after the world file is ready: the S3 upload and
 * its SSM completion poll, the final status writes, and the delay that lets the frontend observe
 * "completed" before the row is deleted.
 */
const POST_WAIT_RESERVE_MS = Number(process.env.WORLD_CREATE_UPLOAD_RESERVE_MS || 90000);

export const beginCreateWorld = async (params: NewWorldRequestData, context: Context) => {
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
	const jobKey = `${WORLD_CREATE_KEY}#${params.instanceID}`;

	// Claim the job before doing anything that touches the instance. Async invocation means lambda
	// retries this worker up to twice on its own after a timeout or crash, and each retry would
	// otherwise dispatch another `-autocreate` run at the same world file — several TShocks writing
	// one .wld, whose size then never stabilizes, so the wait can't succeed either. The claim is
	// conditional on the row still being this job and unclaimed, so only the first invocation
	// proceeds; the losers fall through to hWorker, which records the job as failed. That makes the
	// retry the thing that *detects* a dead first attempt rather than the thing that duplicates it.
	const claimedAt = new Date().toISOString();
	const claim = await DB.UpdateItem(SYSTEM_TABLE, jobKey, {
		UpdateExpression: "SET #workerStartedAt = :now, #updatedAt = :now",
		ExpressionAttributeNames: { "#workerStartedAt": "workerStartedAt", "#updatedAt": "updatedAt" },
		ExpressionAttributeValues: { ":now": claimedAt, ":jid": params.jobID },
		ConditionExpression: "attribute_exists(uid) AND jobID = :jid AND attribute_not_exists(workerStartedAt)",
	});
	if (!claim) {
		throw new Error(
			"World creation was already picked up by an earlier worker for this job — the first attempt " +
			"stopped without reporting a result. Start a new world creation to try again.",
		);
	}

	const instanceTable = process.env.INSTANCE_TABLE_NAME;
	Assert.IsTruthyString(instanceTable, "Instance table name not configured (INSTANCE_TABLE_NAME env var missing)");
	const instanceData = await DB.GetItem(instanceTable!, `inst#${params.instanceID}`) as InstanceDataEntry;
	const worldPaths = instanceData?.worldPaths || [];

	// Thrown rather than returned: a returned error response is a *successful* worker run as far as
	// the invoker is concerned, so the job row would sit at "queued" with nobody left to advance it.
	// Only a throw reaches hWorker's catch and gets the job marked failed.
	if (!worldPaths.some(validPath => params.params.worldFolderPath === validPath)) {
		throw new Error(
			`World file path "${params.params.worldFolderPath}" is not one of the configured world paths ` +
			`for ${params.instanceID}. Check the instance's worldPaths entry.`,
		);
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

	// Never log the plaintext password to CloudWatch.
	const loggableParams = { ...params.params, password: params.params.password ? "[redacted]" : "" };

	const creationUpdate1: SystemWorldCreateEntry = {
		status: "running",
		step: "starting-tshock",
		progress: 20,
		updatedAt: new Date().toISOString()
	};
	await DB.UpdateItem(SYSTEM_TABLE, jobKey, {
		updates: creationUpdate1
	});

	// TShock ignores CLI passwords, so write the requested server password into config.json before
	// the -autocreate run (which generates the world and then serves it) reads it. Blank = leave the
	// existing config password untouched. The instance is already running with SSM ready (ensured by
	// queueCreateWorld before this worker was invoked).
	if (params.params.password && String(params.params.password).trim()) {
		await applyServerPasswordToConfig(params.instanceID, String(params.params.password));
	}

	const SSM = new SsmDao();
	const tshockResult = await SSM.ExecuteCommand(params.instanceID, [command]);

	CWLogger.CAction(3, FUNC_NAMES.SERV_MGR, {
		userId: params.requestedBy,
		action: "create-world",
		status: "command-dispatched",
		details: {
			commandID: tshockResult.commandId,
			worldFilePath,
			params: loggableParams
		}
	});

	const creationUpdate2: SystemWorldCreateEntry = {
		step: "waiting-for-world-file",
		progress: 45,
		updatedAt: new Date().toISOString()
	};
	await DB.UpdateItem(SYSTEM_TABLE, jobKey, {
		updates: creationUpdate2
	});
	
	const outLogPath = resolveOutLogPath();
	await waitForWorldFileReady(worldFilePath, params.instanceID, outLogPath, boundedWaitDeadline(context, POST_WAIT_RESERVE_MS), async (line) => {
		const detailUpdate: SystemWorldCreateEntry = {
			...(line !== null ? { detail: line } : {}),
			updatedAt: new Date().toISOString()
		};
		await DB.UpdateItem(SYSTEM_TABLE, jobKey, {
			updates: detailUpdate
		});
	});

	const creationUpdate3: SystemWorldCreateEntry = {
		step: "uploading-world-file",
		progress: 85,
		updatedAt: new Date().toISOString()
	};
	await DB.UpdateItem(SYSTEM_TABLE, jobKey, {
		updates: creationUpdate3
	});

	// Clear out stale tokens
	TShockAPI.DropTokenCache();

	CWLogger.CAction(3, FUNC_NAMES.SERV_MGR, {
		userId: params.requestedBy,
		action: "create-world",
		status: "uploading-world",
		details: {
			worldFilePath,
			params: loggableParams
		}
	});

	const S3 = new S3Dao();

	const upload = await S3.SyncInstanceToS3({
		instanceId: params.instanceID,
		localPath: worldFilePath,
		bucketName: worldsBucket!,
		destinationKey: s3Key,
		isFolder: false,
	});
	await SSM.PollForCommandCompletion(upload.commandId, params.instanceID);

	const creationUpdate4: SystemWorldCreateEntry = {
		status: "completed",
		step: "completed",
		progress: 100,
		updatedAt: new Date().toISOString()
	};
	await DB.UpdateItem(SYSTEM_TABLE, jobKey, {
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
			params: { ...params, params: loggableParams },
			s3Key
		}
	});

	// Give time for the front-end to pick up the "completed entry" 
	// (currently polls every 5s, so a little more than 2 poll cycles should be enough)
	await new Delay(12000);

	const success = await DB.DeleteItem(SYSTEM_TABLE, jobKey);
	if (!success) {
		return ResponseUtil.Error("Clean-up failed");
	}

	return ResponseUtil.Success({ ok: true });
};
