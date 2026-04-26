import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/permissions.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { SYSTEM_TABLE, WORLD_CREATE_KEY } from "../shared/vars.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { LambdaDao } from "../../_shared/shared/aws/Lambda.js";
import type { NewWorldRequestData } from "../index.js";
import { Assert } from "../shared/utils/Assert.js";
import type { SystemWorldCreateEntry } from "../shared/schema/SystemTable.js";

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
	if (!password?.trim()) {
		throw new Error("Password cannot be only whitespace");
	}

	if (seed && !/^[a-zA-Z0-9_\s]+$/.test(seed)) {
		throw new Error("Seed must contain only alphanumeric characters, underscores, and spaces");
	}
	if (!seed?.trim()) {
		throw new Error("Seed cannot be only whitespace");
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

	if (!/^[a-zA-Z0-9_\s]+$/.test(worldName)) {
		throw new Error("World name must only include alphanumeric characters, underscores, and whitespace");
	}
	if (!worldName?.trim()) {
		throw new Error("World name cannot be only whitespace");
	}
};

export const queueCreateWorld = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceID = event.pathParameters?.id;
	if (!instanceID) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${instanceID}`);

	try {
		validateCreateWorldInput(event.parsedBody || {});
	} catch (e: any) {
		return ResponseUtil.ValidationError(`Failed to queue world creation: ${e?.message}`);
	}

	const requestedBy = Parsers.GetUserSub(event);
	Assert.IsTruthyString(requestedBy, "No user ID");
	const jobID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const createdAt = new Date().toISOString();

	const DB = new DynamoDao();

	// Block new creation requests while there is currently a world being created
	const creationInProgress = await DB.GetItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${instanceID}`);
	if (creationInProgress) {
		return ResponseUtil.Error("World creation already in progress", 403, "CONFLICT");
	}

	const creationData: SystemWorldCreateEntry = {
		uid: `${WORLD_CREATE_KEY}#${instanceID}`,
		instanceID,
		requestedBy: requestedBy!,
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
			params: event.parsedBody,
			jobID,
			instanceID
		}
	});

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
	await Lambda.InvokeFunction(workerPayload);

	return ResponseUtil.Success({
		message: "World creation started",
		instanceID,
		jobID,
		status: "queued",
		progressMessage: "World creation job queued"
	});
};
