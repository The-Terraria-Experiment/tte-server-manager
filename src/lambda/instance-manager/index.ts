import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../shared/types/APIGatewayTypes.js";
import type { EndpointList } from "../../shared/types/LambdaTypes.js";
import { createHandler } from "./shared/middleware/createHandler.js";
import { Parsers } from "./shared/utils/core/Parsers.js";
import { PERMISSIONS } from "./shared/permissionValues.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { Permissions } from "./shared/utils/core/Perms.js";
import { ResponseUtil } from "./shared/utils/core/APIResponse.js";
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
import { readFileRoots } from "./actions/readFileRoots.js";
import { getInstanceFiles } from "./actions/getInstanceFiles.js";
import { readFileContent } from "./actions/readFileContent.js";
import { writeFileContent } from "./actions/writeFileContent.js";
import { downloadFile } from "./actions/downloadFile.js";
import { readMetricsConfig } from "./actions/readMetricsConfig.js";
import { writeMetricsConfig } from "./actions/writeMetricsConfig.js";
import { triggerMetricsUpload } from "./actions/triggerMetricsUpload.js";
import { shutdownWorker } from "./actions/shutdownWorker.js";
import { readInstanceRegistry } from "./actions/readInstanceRegistry.js";
import { createInstanceRegistration, updateInstanceRegistration } from "./actions/writeInstanceRegistry.js";
import { deleteInstanceRegistration } from "./actions/deleteInstanceRegistration.js";
import type { ShutdownRequestData } from "./shared/utils/jobs/ShutdownJob.js";
import { readMetrics } from "./actions/readMetrics.js";

const endpoints: EndpointList = {
	"GET /instances": {
		action: list,
		permRequired: PERMISSIONS.instance.list,
	},
	// The registry — which instances exist and which environments they belong to. Replaces the
	// EC2_INSTANCE_IDS / AUTO_SHUTOFF_SERVER_IDS_* env vars. Hosted here rather than in
	// system-manager because this function already holds INSTANCE_TABLE_NAME, Dynamo access to that
	// table, and ec2:DescribeInstances.
	"GET /instances/registry": {
		action: readInstanceRegistry,
		permRequired: PERMISSIONS.system.instances.list.read,
	},
	"POST /instances/registry": {
		action: createInstanceRegistration,
		permRequired: PERMISSIONS.system.instances.list.write,
	},
	"PUT /instances/registry/{id}": {
		action: updateInstanceRegistration,
		permRequired: PERMISSIONS.system.instances.list.write,
	},
	"POST /instances/registry/{id}/delete": {
		action: deleteInstanceRegistration,
		permRequired: PERMISSIONS.system.instances.list.write,
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
	// The collected samples themselves, read out of S3 for a requested time window.
	// The collector's own on/off and timing config live under /metrics/config below.
	"GET /instance/{id}/metrics": {
		action: readMetrics,
		permRequired: PERMISSIONS.instance.metrics.read,
	},
	"GET /instance/{id}/metrics/config": {
		action: readMetricsConfig,
		permRequired: PERMISSIONS.instance.metrics.read,
	},
	"PUT /instance/{id}/metrics/config": {
		action: writeMetricsConfig,
		permRequired: PERMISSIONS.instance.metrics.write,
	},
	// A read-tier permission on purpose: this refreshes what's in S3, it doesn't
	// change how the collector is configured.
	"POST /instance/{id}/metrics/upload": {
		action: triggerMetricsUpload,
		permRequired: PERMISSIONS.instance.metrics.read,
	},
	"GET /instance/{id}/files": {
		action: readFiles,
		// World list (SelectWorld) and the file hierarchy (InstanceFiles) share this
		// single listing endpoint, so either permission is sufficient to fetch it.
		permRequired: [PERMISSIONS.server.world.list, PERMISSIONS.instance.files.read],
	},
	"POST /instance/{id}/files/tree": {
		action: getInstanceFiles,
		permRequired: PERMISSIONS.server.config.read,
	},
	"POST /instance/{id}/files/content": {
		action: readFileContent,
		permRequired: PERMISSIONS.server.config.read,
	},
	"POST /instance/{id}/files": {
		action: uploadFiles,
		permRequired: PERMISSIONS.instance.files.write,
	},
	"POST /instance/{id}/files/delete": {
		action: deleteFiles,
		permRequired: PERMISSIONS.instance.files.write,
	},
	"POST /instance/{id}/files/download": {
		action: downloadFile,
		permRequired: PERMISSIONS.instance.files.read,
	},
	"PUT /instance/{id}/files/content": {
		action: writeFileContent,
		permRequired: PERMISSIONS.server.config.write,
	},
	"PUT /instance/{id}/files": {
		action: fileSync,
		permRequired: PERMISSIONS.instance.files.write,
	},
	"POST /instance/{id}/paths": {
		action: editPaths,
		permRequired: PERMISSIONS.instance.files.paths.write,
	},
	"GET /instance/{id}/paths": {
		action: readFileRoots,
		permRequired: PERMISSIONS.instance.files.paths.read,
	},
}

const hNormal = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
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
	});

	// Full event/context dump — only worth the log volume when actively debugging a specific
	// request. LOG_LEVEL is off by default, so this costs nothing on the hot path.
	CWLogger.CAction(4, FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "invoke-action-detail",
		resource: routeKey,
		details: { context, event },
	});

	return endpointDetails.action(event, context);
}

const hWorker = async (event: ShutdownRequestData, context: Context): Promise<APIGatewayProxyResult> => {
	CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: event.requestedBy,
		action: "invoke-worker",
		resource: event.instanceID,
	});

	CWLogger.CAction(4, FUNC_NAMES.INST_MGR, {
		userId: event.requestedBy,
		action: "invoke-worker-detail",
		resource: event.instanceID,
		details: { event },
	});

	return shutdownWorker(event, context);
}

const h = async (event: AuthorizedEvent | ShutdownRequestData, context: Context): Promise<APIGatewayProxyResult> => {
	let result: APIGatewayProxyResult;

	if ("requestType" in event && event.requestType === "shutdown-request") {
		result = await hWorker(event as ShutdownRequestData, context);
	} else {
		result = await hNormal(event as AuthorizedEvent, context);
	}

	await CWLogger.FlushAll();

	return result;
}

export const handler = createHandler(Parsers.InsertParsedBody(h));
