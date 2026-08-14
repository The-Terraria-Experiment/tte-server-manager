import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../shared/types/APIGatewayTypes.js";
import type { EndpointList } from "../../shared/types/LambdaTypes.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { createHandler } from "./shared/middleware/createHandler.js";
import { ResponseUtil } from "./shared/utils/core/APIResponse.js";
import { Parsers } from "./shared/utils/core/Parsers.js";
import { Permissions } from "./shared/utils/core/Perms.js";
import { PERMISSIONS } from "./shared/permissionValues.js";
import { queueCreateWorld } from "./actions/queueCreateWorld.js";
import { beginCreateWorld } from "./actions/beginCreateWorld.js";
import type { SystemWorldCreateEntry } from "./shared/schema/SystemTable.js";
import { writeWorldgenProgress } from "./shared/utils/jobs/WorldgenJob.js";
import { getWorldgenStatus } from "./actions/createWorldStatus.js";
import { launchWorld } from "./actions/launchWorld.js";
import { managePlayer } from "./actions/managePlayer.js";
import { readPlayer } from "./actions/readPlayer.js";
import { readPlayerInventory } from "./actions/readPlayerInventory.js";
import { editPlayerInventory } from "./actions/editPlayerInventory.js";
import { getBans } from "./actions/getBans.js";
import { deleteBan } from "./actions/deleteBan.js";
import { getStatus } from "./actions/getStatus.js";
import { stop } from "./actions/stop.js";
import { readConfig } from "./actions/readConfig.js";
import { writeConfig } from "./actions/writeConfig.js";
import { reloadConfig } from "./actions/reloadConfig.js";
import { dropCache } from "./actions/dropCache.js";
import { runCommand } from "./actions/runCommand.js";
import { getItemRules } from "./actions/getItemRules.js";
import { putItemRules } from "./actions/putItemRules.js";
import { getItemViolations } from "./actions/getItemViolations.js";
import { queueItemScan } from "./actions/queueItemScan.js";
import { dismissItemViolations } from "./actions/dismissItemViolations.js";
import { scanInventorySnapshots } from "./actions/scanInventorySnapshots.js";
import { listSnapshotSessions } from "./actions/listSnapshotSessions.js";
import { listSnapshotPlayers } from "./actions/listSnapshotPlayers.js";
import { listSnapshots } from "./actions/listSnapshots.js";
import { readSnapshot } from "./actions/readSnapshot.js";
import { writeArchiveSettings } from "./actions/writeArchiveSettings.js";
import { INVENTORY_SCAN_REQUEST_TYPE, type InventoryScanRequestData } from "./shared/utils/jobs/ItemRuleScan.js";

const endpoints: EndpointList = {
	// "GET /servers": {
	// 	action: null,
	// 	permRequired: PERMISSIONS.server.list,
	// },
	"GET /server/{id}/status": {
		action: getStatus,
		permRequired: PERMISSIONS.server.status.read,
	},
	"POST /server/{id}/stop": {
		action: stop,
		permRequired: PERMISSIONS.server.status.stop,
	},
	"GET /server/{id}/config": {
		action: readConfig,
		permRequired: PERMISSIONS.server.config.read,
	},
	"POST /server/{id}/config": {
		action: writeConfig,
		permRequired: PERMISSIONS.server.config.write,
	},
	"POST /server/{id}/config/reload": {
		action: reloadConfig,
		permRequired: PERMISSIONS.server.config.write,
	},
	"POST /server/{id}/tshock/command": {
		action: runCommand,
		permRequired: PERMISSIONS.server.tshock.execute,
	},
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
		permRequired: PERMISSIONS.server.world.launch,
	},
	// "DELETE /server/{id}/world/{worldId}/delete": {
	// 	action: null,
	// 	permRequired: PERMISSIONS.server.world.delete,
	// },
	"POST /server/dropcache": {
		action: dropCache,
		permRequired: PERMISSIONS.system.dropcache
	},
	"POST /server/{id}/players/ban": {
		action: managePlayer,
		permRequired: PERMISSIONS.server.player.ban
	},
	"POST /server/{id}/players/kick": {
		action: managePlayer,
		permRequired: PERMISSIONS.server.player.kick
	},
	"POST /server/{id}/players/kill": {
		action: managePlayer,
		permRequired: PERMISSIONS.server.player.kill
	},
	"POST /server/{id}/players/mute": {
		action: managePlayer,
		permRequired: PERMISSIONS.server.player.mute
	},
	"GET /server/{id}/players/{player}": {
		action: readPlayer,
		permRequired: PERMISSIONS.server.player.read
	},
	"GET /server/{id}/players/{player}/inventory": {
		action: readPlayerInventory,
		permRequired: PERMISSIONS.server.player.inventory.read
	},
	"POST /server/{id}/players/{player}/inventory": {
		action: editPlayerInventory,
		permRequired: PERMISSIONS.server.player.inventory.write
	},
	"GET /server/{id}/items/rules": {
		action: getItemRules,
		permRequired: PERMISSIONS.server.player.inventory.rules.read
	},
	"PUT /server/{id}/items/rules": {
		action: putItemRules,
		permRequired: PERMISSIONS.server.player.inventory.rules.write
	},
	"GET /server/{id}/items/violations": {
		action: getItemViolations,
		permRequired: PERMISSIONS.server.player.inventory.violations.read
	},
	"POST /server/{id}/items/violations/dismiss": {
		action: dismissItemViolations,
		permRequired: PERMISSIONS.server.player.inventory.violations.write
	},
	"POST /server/{id}/items/scan": {
		action: queueItemScan,
		permRequired: PERMISSIONS.server.player.inventory.violations.read
	},
	// The snapshot archive. Reads live here rather than in logs-manager because the *write* has to —
	// the scan worker is the only place a full capture ever exists — so one function carries the
	// bucket env var and the IAM for this prefix instead of two.
	"GET /server/{id}/inventory/sessions": {
		action: listSnapshotSessions,
		permRequired: PERMISSIONS.server.player.inventory.snapshots.read
	},
	"GET /server/{id}/inventory/players": {
		action: listSnapshotPlayers,
		permRequired: PERMISSIONS.server.player.inventory.snapshots.read
	},
	"GET /server/{id}/inventory/snapshots": {
		action: listSnapshots,
		permRequired: PERMISSIONS.server.player.inventory.snapshots.read
	},
	"GET /server/{id}/inventory/snapshot": {
		action: readSnapshot,
		permRequired: PERMISSIONS.server.player.inventory.snapshots.read
	},
	"PUT /server/{id}/inventory/archive": {
		action: writeArchiveSettings,
		permRequired: PERMISSIONS.server.player.inventory.snapshots.write
	},
	"GET /server/{id}/bans": {
		action: getBans,
		permRequired: PERMISSIONS.server.player.ban
	},
	"POST /server/{id}/bans/delete": {
		action: deleteBan,
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

type WorkerRequestData = NewWorldRequestData | InventoryScanRequestData;

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
	});

	// Full event/context dump — only worth the log volume when actively debugging a specific
	// request. LOG_LEVEL is off by default, so this costs nothing on the hot path.
	CWLogger.CAction(4, FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "invoke-action-detail",
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

	CWLogger.CAction(4, FUNC_NAMES.SERV_MGR, {
		userId: event.requestedBy,
		action: "invoke-worker-detail",
		resource: null,
		details: { context, event },
	});

	let creationResult;
	try {
		creationResult = await beginCreateWorld(event, context);
	} catch (e: any) {
		const failureReason = e?.message ?? "unknown error";

		CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			userId: event.requestedBy,
			action: "create-world",
			error: failureReason,
			stack: new Error().stack,
			details: {
				event
			}
		});

		// The reason is stored on the job so the frontend can say *what* went wrong instead of a bare
		// "World creation failed" — for worldgen the useful cases (TShock never started, world path not
		// configured, ran out of time mid-generation) are indistinguishable to a user otherwise.
		const errorUpdate: SystemWorldCreateEntry = {
			status: "failed",
			step: "failed",
			failureReason,
			updatedAt: new Date().toISOString(),
		};
		await writeWorldgenProgress(event.instanceID, errorUpdate);

		// Returned, not rethrown: this worker is invoked asynchronously, so a throw would have lambda
		// retry it — and the job is already recorded as failed, so a retry could only muddy that.
		return ResponseUtil.Error(failureReason);
	}

	return creationResult;
}

const h = async (event: AuthorizedEvent | WorkerRequestData, context: Context): Promise<APIGatewayProxyResult> => {
	let result: APIGatewayProxyResult;

	if ("requestType" in event && event.requestType === "new-world-request") {
		result = await hWorker(event as NewWorldRequestData, context);
	} else if ("requestType" in event && event.requestType === INVENTORY_SCAN_REQUEST_TYPE) {
		// No wrapper equivalent to hWorker's failure recording: the scan owns no job row a frontend is
		// polling, and its own catch block releases the lease and logs. There is nothing left to
		// record here that would not be a duplicate.
		result = await scanInventorySnapshots(event as InventoryScanRequestData, context);
	} else {
		result = await hNormal(event as AuthorizedEvent, context);
	}

	await CWLogger.FlushAll();

	return result;
};

export const handler = createHandler(Parsers.InsertParsedBody(h));
