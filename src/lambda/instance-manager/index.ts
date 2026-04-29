import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../shared/types/APIGatewayTypes.js";
import type { EndpointList } from "../../shared/types/LambdaTypes.js";
import { errorHandler } from "./shared/middleware/errorHandler.js";
import { Parsers } from "./shared/utils/Parsers.js";
import { PERMISSIONS } from "./shared/permissionValues.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { Permissions } from "./shared/utils/Perms.js";
import { ResponseUtil } from "./shared/utils/APIResponse.js";
import { list } from "./actions/list.js";
import { getStatus } from "./actions/getStatus.js";
import { start } from "./actions/start.js";
import { stop } from "./actions/stop.js";
import { restart } from "./actions/restart.js";
import { readFiles } from "./actions/readFiles.js";
import { uploadFiles } from "./actions/uploadFiles.js";
import { deleteFiles } from "./actions/deleteFiles.js";
import { fileSync } from "./actions/fileSync.js";
import { editPaths } from "./actions/editPaths.js";

const endpoints: EndpointList = {
	"GET /instances": {
		action: list,
		permRequired: PERMISSIONS.instance.list,
	},
	"GET /instance/{id}/status": {
		action: getStatus,
		permRequired: PERMISSIONS.instance.status.read,
	},
	"POST /instance/{id}/start": {
		action: start,
		permRequired: PERMISSIONS.instance.status.start,
	},
	"POST /instance/{id}/stop": {
		action: stop,
		permRequired: PERMISSIONS.instance.status.stop,
	},
	"POST /instance/{id}/restart": {
		action: restart,
		permRequired: PERMISSIONS.instance.status.restart,
	},
	"GET /instance/{id}/metrics": {
		action: null,
		permRequired: PERMISSIONS.instance.metrics.read,
	},
	"GET /instance/{id}/files": {
		action: readFiles,
		permRequired: PERMISSIONS.instance.files.read,
	},
	"POST /instance/{id}/files": {
		action: uploadFiles,
		permRequired: PERMISSIONS.instance.files.write,
	},
	"POST /instance/{id}/files/delete": {
		action: deleteFiles,
		permRequired: PERMISSIONS.instance.files.write,
	},
	"PUT /instance/{id}/files": {
		action: fileSync,
		permRequired: PERMISSIONS.instance.files.write,
	},
	"POST /instance/{id}/paths": {
		action: editPaths,
		permRequired: PERMISSIONS.instance.files.paths.write,
	}
}

const h = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	CWLogger.Action(FUNC_NAMES.INST_MGR, {
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

	CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "invoke-action",
		status: "permission validated",
		resource: routeKey,
		details: { context, event }
	});

	await CWLogger.FlushAll();

	return endpointDetails.action(event, context);
}

export const handler = errorHandler(Parsers.InsertParsedBody(h));
