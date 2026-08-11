import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { WebSocketEvent } from "../../shared/types/WebSocketTypes.js";
import { errorHandler } from "./shared/middleware/errorHandler.js";
import { ResponseUtil } from "./shared/utils/core/APIResponse.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { REALTIME_PUBLISH_REQUEST_TYPE, type RealtimePublishRequest } from "./shared/utils/realtime/RealtimeEvents.js";
import { connect } from "./actions/connect.js";
import { disconnect } from "./actions/disconnect.js";
import { defaultRoute } from "./actions/defaultRoute.js";
import { publish } from "./actions/publish.js";

/**
 * Owns the WebSocket notification pipeline: connection lifecycle plus event fan-out.
 *
 * Why this is a function of its own rather than routes bolted onto an existing manager: a reconnect
 * storm is a concurrency spike, and landing that spike on (say) `system-manager` would take roles and
 * notices down with it. The entire premise of this feature is that the socket is optional — sharing a
 * function would make that structurally false.
 *
 * Why fan-out lives here too, as a fourth branch rather than a fifth function: it concentrates
 * `execute-api:ManageConnections`, the connection registry and the API Gateway Management SDK in one
 * place, and the `requestType` discriminator is the same pattern `instance-manager` uses for
 * `shutdown-request`.
 *
 * It composes `errorHandler` but deliberately **not** `createHandler`, which would add `corsHandler`.
 * CORS does not apply to a WebSocket handshake — there is no preflight, and a browser does not check
 * `Access-Control-Allow-Origin` on a 101 — so that header would be meaningless noise on every
 * response, resolved against an origin nothing consults. Same reasoning as `tshock-proxy`.
 *
 * It also skips `Parsers.InsertParsedBody`, which is typed for API Gateway REST events and would need
 * casting to accept these. `$default` is the only route with a body and parses its own.
 */

type RealtimeEventInput = WebSocketEvent | RealtimePublishRequest;

const isPublishRequest = (event: RealtimeEventInput): event is RealtimePublishRequest =>
	"requestType" in event && event.requestType === REALTIME_PUBLISH_REQUEST_TYPE;

const h = async (event: RealtimeEventInput, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	let result: APIGatewayProxyResult;

	if (isPublishRequest(event)) {
		result = await publish(event);
	} else {
		const routeKey = event.requestContext?.routeKey;

		switch (routeKey) {
			case "$connect":
				result = await connect(event);
				break;
			case "$disconnect":
				result = await disconnect(event);
				break;
			case "$default":
				result = await defaultRoute(event);
				break;
			default:
				result = ResponseUtil.NotFoundError("Route");
		}
	}

	await CWLogger.FlushAll();

	return result;
};

export const handler = errorHandler<RealtimeEventInput>(h);
