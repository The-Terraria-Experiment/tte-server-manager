import type { APIGatewayProxyResult } from "aws-lambda";
import type { WebSocketEvent } from "../../../shared/types/WebSocketTypes.js";
import { RealtimeTicket } from "../shared/utils/realtime/RealtimeTicket.js";
import { RealtimeConnections } from "../shared/utils/realtime/RealtimeConnections.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";

/**
 * `$connect` — verifies the connect ticket and records the connection.
 *
 * There is no API Gateway authorizer on this route: the ticket is an HMAC we issued ourselves, so
 * verifying it inline and returning 401 is both simpler and avoids touching `api-authorizer`, which
 * gates the entire REST API.
 *
 * **Never log the event.** The ticket is in `queryStringParameters`. The manager lambdas' dispatchers
 * log `details: { context, event }`, and copying that habit here would put credentials in CloudWatch
 * on every connect.
 */
export const connect = async (event: WebSocketEvent): Promise<APIGatewayProxyResult> => {
	const { connectionId, domainName, stage } = event.requestContext;
	const ticket = event.queryStringParameters?.ticket;

	const userSub = await RealtimeTicket.VerifySub(ticket);
	if (!userSub) {
		await CWLogger.Action(FUNC_NAMES.REALTIME_MGR, {
			userId: null,
			action: "ws-connect",
			status: "401",
			resource: null,
			// Presence only. The ticket itself must never be logged.
			details: { connectionId, ticketPresent: Boolean(ticket) },
		});
		return { statusCode: 401, body: "Unauthorized" };
	}

	// Taken off the event rather than an env var, so it is automatically right for both stages and for
	// a custom domain, and there is one less hand-set variable to get wrong.
	const apiEndpoint = `https://${domainName}/${stage}`;

	const stored = await RealtimeConnections.Put({ connectionId, userSub, apiEndpoint });
	if (!stored) {
		// DynamoDao swallows its errors and returns false. Refuse the connection rather than accept one
		// that fan-out will never find — a client that believes it is subscribed and never hears
		// anything is worse than one that knows it failed and falls back to polling.
		await CWLogger.Error(FUNC_NAMES.REALTIME_MGR, {
			error: "Failed to record websocket connection",
			details: { action: "ws-connect", connectionId, userSub },
		});
		return { statusCode: 500, body: "Could not register connection" };
	}

	await CWLogger.Action(FUNC_NAMES.REALTIME_MGR, {
		userId: userSub,
		action: "ws-connect",
		status: "200",
		resource: null,
		details: { connectionId, apiEndpoint },
	});

	return { statusCode: 200, body: "Connected" };
};
