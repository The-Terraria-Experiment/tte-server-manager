import type { APIGatewayProxyResult } from "aws-lambda";
import type { WebSocketEvent } from "../../../shared/types/WebSocketTypes.js";
import { RealtimeConnections } from "../shared/utils/realtime/RealtimeConnections.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";

/**
 * `$disconnect` — drops the connection row.
 *
 * Best-effort by nature: API Gateway does not guarantee this route fires, so it is one of three
 * cleanup paths rather than the only one. The authoritative one is the `GoneException` delete on
 * publish; Dynamo TTL is the backstop for rows that escape both.
 *
 * Always returns 200. Nothing acts on the response, and a non-2xx here only produces noise in the
 * API's own metrics for a connection that is already gone.
 */
export const disconnect = async (event: WebSocketEvent): Promise<APIGatewayProxyResult> => {
	const { connectionId } = event.requestContext;

	const deleted = await RealtimeConnections.Delete(connectionId);

	await CWLogger.Action(FUNC_NAMES.REALTIME_MGR, {
		userId: null,
		action: "ws-disconnect",
		status: deleted ? "200" : "500",
		resource: null,
		details: { connectionId, deleted },
	});

	return { statusCode: 200, body: "Disconnected" };
};
