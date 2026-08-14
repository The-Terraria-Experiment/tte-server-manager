import type { APIGatewayProxyResult } from "aws-lambda";
import { RealtimeConnections } from "../shared/utils/realtime/RealtimeConnections.js";
import { ApiGatewayManagementDao } from "../shared/aws/ApiGatewayManagement.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import type { RealtimePublishRequest } from "../shared/utils/realtime/RealtimeEvents.js";

/**
 * Fan-out: delivers one event to every live connection.
 *
 * Reached by async self-invoke from `Realtime.Publish`, which is what keeps
 * `execute-api:ManageConnections`, the connection registry and the API Gateway Management SDK in one
 * function and one IAM role.
 *
 * Events are **broadcast**. They carry an instance id and nothing else, and the REST refetch each one
 * triggers runs the real `ValidatePermission` + `ValidateResourceAccess` checks — so a client without
 * access learns only that an instance exists, and gets nothing from it. `userSub` is recorded on every
 * connection row, so filtering here later is a small change (`Permissions.CheckResourceAccess` already
 * has a cached per-user lookup) if that existence leak ever matters.
 */
export const publish = async (request: RealtimePublishRequest): Promise<APIGatewayProxyResult> => {
	const { event } = request;

	if (!event?.type || !event?.instanceId) {
		return ResponseUtil.ValidationError("A realtime event with a type and instanceId is required");
	}

	const connections = await RealtimeConnections.List();
	if (!connections.length) {
		return ResponseUtil.Success({ sent: 0, gone: 0, failed: 0 });
	}

	const AGM = new ApiGatewayManagementDao();

	// allSettled, not all: one dead connection must not be able to abort delivery to the rest.
	const results = await Promise.allSettled(
		connections.map(async (connection) => {
			if (!connection.connectionId || !connection.apiEndpoint) {
				return { connectionId: connection.connectionId, result: "failed" as const };
			}

			const result = await AGM.PostToConnection(connection.apiEndpoint, connection.connectionId, event);
			return { connectionId: connection.connectionId, result };
		}),
	);

	let sent = 0;
	let gone = 0;
	let failed = 0;
	const staleConnectionIds: string[] = [];

	for (const settled of results) {
		if (settled.status !== "fulfilled") {
			failed++;
			continue;
		}

		if (settled.value.result === "ok") {
			sent++;
		} else if (settled.value.result === "gone") {
			gone++;
			if (settled.value.connectionId) {
				staleConnectionIds.push(settled.value.connectionId);
			}
		} else {
			failed++;
		}
	}

	// The authoritative cleanup path. Skipping it would grow fan-out cost monotonically forever, since
	// $disconnect is not guaranteed to fire and TTL is hours away.
	await Promise.allSettled(staleConnectionIds.map((id) => RealtimeConnections.Delete(id)));

	// Counts only, one line per publish. A log line per connection would scale with open browsers
	// against an event stream that is already the highest-frequency thing this system does.
	await CWLogger.Action(FUNC_NAMES.REALTIME_MGR, {
		userId: null,
		action: "ws-publish",
		status: "200",
		resource: event.type,
		details: { instanceId: event.instanceId, hint: event.hint ?? null, sent, gone, failed },
	});

	return ResponseUtil.Success({ sent, gone, failed });
};
