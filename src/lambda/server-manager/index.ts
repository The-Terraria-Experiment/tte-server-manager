import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../shared/types/APIGatewayTypes.js";
import type { EndpointList } from "../../shared/types/LambdaTypes.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { errorHandler } from "./shared/middleware/errorHandler.js";
import { ResponseUtil } from "./shared/utils/APIResponse.js";
import { Parsers } from "./shared/utils/Parsers.js";
import { Permissions } from "./shared/utils/permissions.js";
import { PERMISSIONS } from "./shared/permissionValues.js";
import { queueCreateWorld } from "./actions/queueCreateWorld.js";
import { beginCreateWorld } from "./actions/beginCreateWorld.js";
import type { SystemWorldCreateEntry } from "./shared/schema/SystemTable.js";
import { SYSTEM_TABLE, WORLD_CREATE_KEY } from "./shared/vars.js";
import { DynamoDao } from "./shared/aws/DynamoDB.js";
import { getWorldgenStatus } from "./actions/createWorldStatus.js";
import { launchWorld } from "./actions/launchWorld.js";

const endpoints: EndpointList = {
	"GET /servers": {
		action: null,
		permRequired: PERMISSIONS.server.list,
	},
	"GET /server/{id}/status": {
		action: null,
		permRequired: PERMISSIONS.server.status.read,
	},
	"POST /server/{id}/start": {
		action: null,
		permRequired: PERMISSIONS.server.status.start,
	},
	"POST /server/{id}/stop": {
		action: null,
		permRequired: PERMISSIONS.server.status.stop,
	},
	"GET /server/{id}/config": {
		action: null,
		permRequired: PERMISSIONS.server.config.read,
	},
	"POST /server/{id}/config": {
		action: null,
		permRequired: PERMISSIONS.server.config.write,
	},
	"POST /server/{id}/config/reload": {
		action: null,
		permRequired: PERMISSIONS.server.config.write,
	},
	// "PUT /server/{id}/config": {
	// 	action: null,
	// 	permRequired: PERMISSIONS.server.config.write,
	// },
	// "POST /server/{id}/tshock": {
	// 	action: null,
	// 	permRequired: PERMISSIONS.server.tshock.execute,
	// },
	// "GET /server/{id}/world/list": {
	// 	action: null,
	// 	permRequired: PERMISSIONS.server.world.list,
	// },
	"POST /server/{id}/world/create": {
		action: queueCreateWorld,
		permRequired: PERMISSIONS.server.world.create,
	},
	"GET /server/{id}/world/create/{jobId}/status": {
		action: getWorldgenStatus,
		permRequired: PERMISSIONS.server.world.create,
	},
	"POST /server/{id}/world/{worldId}/select": {
		action: launchWorld,
		permRequired: PERMISSIONS.server.world.select,
	},
	"DELETE /server/{id}/world/{worldId}/delete": {
		action: null,
		permRequired: PERMISSIONS.server.world.delete,
	},
	"POST /server/dropcache": {
		action: null,
		permRequired: PERMISSIONS.system.dropcache
	},
	"POST /server/{id}/players/ban": {
		action: null,
		permRequired: PERMISSIONS.server.player.ban
	},
	"POST /server/{id}/players/kick": {
		action: null,
		permRequired: PERMISSIONS.server.player.kick
	},
	"POST /server/{id}/players/kill": {
		action: null,
		permRequired: PERMISSIONS.server.player.kill
	},
	"POST /server/{id}/players/mute": {
		action: null,
		permRequired: PERMISSIONS.server.player.mute
	},
	"GET /server/{id}/players/{player}": {
		action: null,
		permRequired: PERMISSIONS.server.player.read
	},
	"GET /server/{id}/bans": {
		action: null,
		permRequired: PERMISSIONS.server.player.ban
	},
	"POST /server/{id}/bans/delete": {
		action: null,
		permRequired: PERMISSIONS.server.player.ban
	}
};

export type NewWorldRequestParams = {
	worldFolderPath: string,
	size: number,
	difficulty: number,
	evil: number,
	seed: string,
	worldName: string,
	port: number,
	maxPlayers: number,
	password: string,
}

export type NewWorldRequestData = {
	requestType: "new-world-request",
	jobID: string,
	instanceID: string,
	requestedBy: string,
	params: NewWorldRequestParams
};

const hNormal = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "invoke-normal",
		resource: null,
	});

	const { httpMethod, resource } = event;
	const routeKey = `${httpMethod} ${resource}`;
	const endpointDetails = endpoints[routeKey];
	if (!endpointDetails || !endpointDetails.action) {
		return ResponseUtil.NotFoundError("Route");
	}

	await Permissions.ValidatePermission(event, endpointDetails.permRequired);

	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "invoke-action",
		status: "permission-validated",
		resource: routeKey,
		details: { context, event },
	});

	return endpointDetails.action(event, context);
};

const hWorker = async (event: NewWorldRequestData, context: Context): Promise<APIGatewayProxyResult> => {
	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: event.requestedBy,
		action: "invoke-worker",
		resource: null,
	});

	let creationResult;
	try {
		creationResult = beginCreateWorld(event);
	} catch (e: any) {
		const DB = new DynamoDao();
		const errorUpdate: SystemWorldCreateEntry = {
			status: "failed",
			step: "failed",
			updatedAt: new Date().toISOString(),
		};
		await DB.UpdateItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${event.instanceID}`, {
			updates: errorUpdate
		});

		CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			userId: event.requestedBy,
			action: "create-world",
			error: e?.message,
			stack: new Error().stack,
			details: {
				event
			}
		});

		return ResponseUtil.Error(e?.message ?? "unknown error");
	}
	
	return creationResult;
}

const h = async (event: AuthorizedEvent | NewWorldRequestData, context: Context): Promise<APIGatewayProxyResult> => {
	if ("requestType" in event && event.requestType === "new-world-request") {
		return hWorker(event as NewWorldRequestData, context);
	} else {
		return hNormal(event as AuthorizedEvent, context);
	}
};

export const handler = errorHandler(Parsers.InsertParsedBody(h));
