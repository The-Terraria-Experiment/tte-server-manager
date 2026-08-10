import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../shared/types/APIGatewayTypes.js";
import type { EndpointList, KeyedEndpointList } from "../../shared/types/LambdaTypes.js";
import { createHandler } from "./shared/middleware/createHandler.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { Parsers } from "./shared/utils/core/Parsers.js";
import { ResponseUtil } from "./shared/utils/core/APIResponse.js";
import { PERMISSIONS } from "./shared/permissionValues.js";
import { Permissions } from "./shared/utils/core/Perms.js";
import { pushLog } from "./actions/pushLog.js";
import { getLogs } from "./actions/getLogs.js";
import { searchTShockLogs } from "./actions/searchTShockLogs.js";
import { getTShockLogTranscript } from "./actions/getTShockLogTranscript.js";
import { listTShockLogs } from "./actions/listTShockLogs.js";

const automatedEndpoints: KeyedEndpointList = {
	"POST /logging/{id}/players/push": {
		action: pushLog,
	},
};

const endpoints: EndpointList = {
	"POST /logging/{id}/players/fetch": {
		action: getLogs,
		permRequired: PERMISSIONS.server.logs.players.read,
	},
	"POST /logging/{id}/tshock/search": {
		action: searchTShockLogs,
		permRequired: PERMISSIONS.server.logs.tshock.read,
	},
	"POST /logging/{id}/tshock/list": {
		action: listTShockLogs,
		permRequired: PERMISSIONS.server.logs.tshock.read,
	},
	"POST /logging/{id}/tshock/transcript": {
		action: getTShockLogTranscript,
		permRequired: PERMISSIONS.server.logs.tshock.read,
	},
};

const automated = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	CWLogger.Action(FUNC_NAMES.LOG_MGR, {
		userId: "[automated]", 
		action: "invoke",
	});

	const { httpMethod, resource } = event;
	const routeKey = `${httpMethod} ${resource}`;
	const endpointDetails = automatedEndpoints[routeKey];
	if (!endpointDetails || !endpointDetails.action) {
		return ResponseUtil.NotFoundError("Route");
	}

	return endpointDetails.action(event, context);
};

const normal = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	CWLogger.Action(FUNC_NAMES.LOG_MGR, {
		userId: Parsers.GetUserSub(event), 
		action: "invoke",
	});

	const { httpMethod, resource } = event;
	const routeKey = `${httpMethod} ${resource}`;
	const endpointDetails = endpoints[routeKey];
	if (!endpointDetails || !endpointDetails.action) {
		return ResponseUtil.NotFoundError("Route");
	}

	await Permissions.ValidatePermission(event, endpointDetails.permRequired);

	CWLogger.Action(FUNC_NAMES.LOG_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "invoke-action",
		status: "permission validated",
		resource: routeKey,
		details: { context, event }
	});

	return endpointDetails.action(event, context);
};

const h = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	let result: APIGatewayProxyResult;

	if (event.requestContext.identity.apiKey) {
		result = await automated(event, context);
	} else {
		result = await normal(event, context);
	}	

	await CWLogger.FlushAll();

	return result;
}

export const handler = createHandler(Parsers.InsertParsedBody(h));
