import type { APIGatewayProxyResult, Context } from "aws-lambda";
import { errorHandler } from "./shared/middleware/errorHandler.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { Parsers } from "./shared/utils/Parsers.js";
import type { AuthorizedEvent } from "../../shared/types/APIGatewayTypes.js";
import type { EndpointList } from "../../shared/types/LambdaTypes.js";
import { PERMISSIONS } from "../shared/permissionValues.js";
import { ResponseUtil } from "./shared/utils/APIResponse.js";
import { Permissions } from "./shared/utils/Permissions.js";
import { readOwnPermissions } from "./actions/readOwnPermissions.js";
import { readPermissions } from "./actions/readPermissions.js";
import { writePermissions } from "./actions/writePermissions.js";
import { writeResourcePermissions } from "./actions/writeResourcePermissions.js";
import { setUsername } from "./actions/setUsername.js";
import { dropcache } from "./actions/dropcache.js";

const endpoints: EndpointList = {
	"GET /users": {
		action: readPermissions,
		permRequired: PERMISSIONS.users.list
	},
	"GET /users/logs": {
		// TODO: Implement dedicated logs action in TypeScript when logs endpoint contract is defined.
		action: null,
		permRequired: PERMISSIONS.users.logs.read,
	},
	"GET /users/permissions": {
		action: readPermissions,
		permRequired: PERMISSIONS.users.permissions.read,
	},
	"POST /users/permissions": {
		action: writePermissions,
		permRequired: PERMISSIONS.users.permissions.write,
	},
	"POST /users/resourcepermissions": {
		action: writeResourcePermissions,
		permRequired: PERMISSIONS.users.permissions.write,
	},
	"GET /users/permissions/getown": {
		action: readOwnPermissions,
		permRequired: PERMISSIONS.access
	},
	"POST /users/username": {
		action: setUsername,
		permRequired: PERMISSIONS.access
	},
	"POST /users/dropcache": {
		action: dropcache,
		permRequired: PERMISSIONS.system.dropcache
	}
}

const h = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	CWLogger.Action(FUNC_NAMES.USER_MGR, {
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

	CWLogger.Action(FUNC_NAMES.USER_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "invoke-action",
		status: "permission validated",
		resource: routeKey,
		details: { context, event }
	});

	return endpointDetails.action(event, context);
}

export const handler = errorHandler(Parsers.InsertParsedBody(h));
