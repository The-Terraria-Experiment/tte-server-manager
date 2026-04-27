import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../shared/types/APIGatewayTypes.js";
import type { EndpointList } from "../../shared/types/LambdaTypes.js";
import { errorHandler } from "./shared/middleware/errorHandler.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { Parsers } from "./shared/utils/Parsers.js";
import { PERMISSIONS } from "./shared/permissionValues.js";
import { ResponseUtil } from "./shared/utils/APIResponse.js";
import { Permissions } from "./shared/utils/Perms.js";
import { clearnotice } from "./actions/clearnotice.js";
import { notice } from "./actions/notice.js";
import { readNotice } from "./actions/readNotice.js";

const endpoints: EndpointList = {
	"POST /system/postnotice": {
		action: notice,
		permRequired: PERMISSIONS.system.notice.create,
	},
	"POST /system/clearnotice": {
		action: clearnotice,
		permRequired: PERMISSIONS.system.notice.clear,
	},
	"GET /system/notice": {
		action: readNotice,
		permRequired: PERMISSIONS.access,
	},
};

const h = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	CWLogger.Action(FUNC_NAMES.SYS_MGR, {
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

	CWLogger.Action(FUNC_NAMES.SYS_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "invoke-action",
		status: "permission-validated",
		resource: routeKey,
		details: { context, event },
	});

	return endpointDetails.action(event, context);
};

export const handler = errorHandler(Parsers.InsertParsedBody(h));