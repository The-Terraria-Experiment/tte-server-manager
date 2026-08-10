import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { PERM_TABLE, SYSTEM_TABLE, WORLD_CREATE_KEY } from "../shared/vars.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { LambdaDao } from "../shared/aws/Lambda.js";
import type { NewWorldRequestData } from "../index.js";
import { Assert } from "../shared/utils/core/Assert.js";
import type { SystemWorldCreateEntry } from "../shared/schema/SystemTable.js";
import type { UserDataEntry } from "../../_shared/shared/schema/UserTable.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { isWorldgenBlocking, worldgenIdleForMs } from "../shared/utils/jobs/WorldgenJob.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";

const validateCreateWorldInput = (body: Record<PropertyKey, any>) => {
	const { worldFolderPath, port, maxPlayers, password, size, difficulty, evil, seed, worldName } = body;
	
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

	if (password && !/^[a-zA-Z0-9_\s+]+$/.test(password)) {
		throw new Error("Password must contain only alphanumeric characters, underscores, and whitespace");
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
	if (!worldName?.trim()) {
		throw new Error("World name cannot be only whitespace");
	}
};

export const queueCreateWorld = async (event: AuthorizedEvent, context: Context) => {
	const instanceID = event.pathParameters?.id;
	if (!instanceID) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${instanceID}`);

	const blocked = await blockIfShutdownInProgress(instanceID);
	if (blocked) return blocked;

	try {
		validateCreateWorldInput(event.parsedBody || {});
	} catch (e: any) {
		return ResponseUtil.ValidationError(`Failed to queue world creation: ${e?.message}`);
	}

	// Never log the plaintext password to CloudWatch.
	const loggableParams = { ...(event.parsedBody || {}), password: (event.parsedBody || {}).password ? "[redacted]" : "" };

	const requestedBy = Parsers.GetUserSub(event);
	Assert.IsTruthyString(requestedBy, "No user ID");
	const jobID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const createdAt = new Date().toISOString();

	const DB = new DynamoDao();

	const requestedByData = (await DB.GetItem(PERM_TABLE, `user#${requestedBy}`)) as UserDataEntry;
	Assert.IsTruthy(requestedByData, "Could not find requesting user data");
	const requestedByName = requestedByData.displayName;

	// Block new creation requests only while one is genuinely still running. A row that finished
	// (either way) or whose worker stopped heartbeating is a leftover, and refusing on those is what
	// used to wedge an instance permanently: nothing deletes the row on failure, and a worker killed
	// by the lambda timeout never writes a terminal status at all, so every later attempt was
	// rejected against a job that no longer existed. Overwriting a dead row is the recovery path.
	const existingJob = await DB.GetItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${instanceID}`) as SystemWorldCreateEntry | null;
	if (isWorldgenBlocking(existingJob)) {
		return ResponseUtil.Error("World creation already in progress", 409, "CONFLICT");
	}

	if (existingJob) {
		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: requestedBy,
			action: "create-world",
			status: "replacing-stale-job",
			resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
			details: {
				replacedJobID: existingJob.jobID,
				replacedStatus: existingJob.status,
				replacedStep: existingJob.step,
				replacedUpdatedAt: existingJob.updatedAt,
				idleForMs: worldgenIdleForMs(existingJob),
				newJobID: jobID,
				instanceID
			}
		});
	}

	const jobKey = `${WORLD_CREATE_KEY}#${instanceID}`;

	// Once the row exists, every path out of this handler owes the job a terminal status. Anything
	// that leaves it on "queued" is a job the frontend will sit and poll with no worker behind it.
	const failJob = async (reason: string) => {
		const failure: SystemWorldCreateEntry = {
			status: "failed",
			step: "failed",
			failureReason: reason,
			updatedAt: new Date().toISOString(),
		};
		await DB.UpdateItem(SYSTEM_TABLE, jobKey, { updates: failure });
	};

	const creationData: SystemWorldCreateEntry = {
		uid: jobKey,
		instanceID,
		requestedBy: requestedByName || "unknown",
		status: "queued",
		step: "queued",
		progress: 0,
		createdAt,
		updatedAt: createdAt,
		jobID
	};
	await DB.PutItem(SYSTEM_TABLE, creationData);

	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "create-world",
		status: "queued",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: {
			params: loggableParams,
			jobID,
			instanceID
		}
	});

	try {
		const EC2 = new Ec2Dao();
		const SSM = new SsmDao();
		const status = await EC2.GetInstanceStatus(instanceID);
		if (status.state === InstanceState.STOPPED) {
			CWLogger.Action(FUNC_NAMES.SERV_MGR, {
				userId: Parsers.GetUserSub(event),
				action: "launch-instance",
				status: "preparing-instance",
				resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
				details: {
					params: loggableParams,
					jobID,
					instanceID
				}
			});
			await EC2.StartInstanceAndAwait(instanceID);
			const ssmOK = await SSM.WaitForInstanceSsm(instanceID);
			if (!ssmOK) {
				throw new Error("The instance started but SSM never came online, so the world could not be generated");
			}
		} else if (
			status.state === InstanceState.PENDING ||
			status.state === InstanceState.SHUTDOWN ||
			status.state === InstanceState.TERMINATED ||
			status.state === InstanceState.STOPPING
		) {
			// We'll allow unknown, cause maybe that's ok. If not, the SSM will error out
			await failJob(`Instance is ${status.state} — world creation needs it running`);
			return ResponseUtil.ValidationError("Instance is not running");
		}

		const Lambda = new LambdaDao();
		const { worldFolderPath, port, maxPlayers, password, size, difficulty, evil, seed, worldName } = event.parsedBody || {};
		const workerPayload: NewWorldRequestData = {
			requestType: "new-world-request",
			jobID,
			instanceID,
			requestedBy: requestedBy!,
			params: {
				worldFolderPath,
				size,
				difficulty,
				evil,
				seed,
				worldName,
				port,
				maxPlayers,
				password
			}
		};
		// Targeted at the alias this request arrived on. Left to default, the invoke resolves through
		// AWS_LAMBDA_FUNCTION_NAME, which is unqualified — the worker would run on $LATEST, whose
		// ACTIVE_ENV is whichever branch deployed most recently. That decides which Dynamo table the
		// job row is written to and which instance gets a world generated on it.
		await Lambda.InvokeFunction(workerPayload, context.invokedFunctionArn);
	} catch (e: any) {
		await failJob(e?.message ?? "World creation could not be started");
		throw e;
	}

	return ResponseUtil.Success({
		message: "World creation started",
		instanceID,
		jobID,
		status: "queued",
		progressMessage: "World creation job queued"
	});
};
