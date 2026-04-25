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
	"POST /server/{id}/tshock": {
		action: null,
		permRequired: PERMISSIONS.server.tshock.execute,
	},
	"GET /server/{id}/world/list": {
		action: null,
		permRequired: PERMISSIONS.server.world.list,
	},
	"POST /server/{id}/world/create": {
		action: null,
		permRequired: PERMISSIONS.server.world.create,
	},
	"GET /server/{id}/world/create/{jobId}/status": {
		action: null,
		permRequired: PERMISSIONS.server.world.create,
	},
	"POST /server/{id}/world/{worldId}/select": {
		action: null,
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

const h = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "invoke",
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

export const handler = errorHandler(Parsers.InsertParsedBody(h));
