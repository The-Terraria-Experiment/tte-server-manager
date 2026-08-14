import type { APIGatewayProxyResult } from "aws-lambda";
import type { WebSocketClientMessage, WebSocketEvent } from "../../../shared/types/WebSocketTypes.js";
import { RealtimeConnections } from "../shared/utils/realtime/RealtimeConnections.js";
import { ApiGatewayManagementDao } from "../shared/aws/ApiGatewayManagement.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";

/**
 * `$default` — the only inbound route. Handles the client's keepalive ping.
 *
 * The ping exists because API Gateway closes a WebSocket after **10 minutes** with no traffic in
 * either direction. On a busy server the event stream keeps the connection alive on its own; this is
 * for quiet hours.
 *
 * The reply goes out through `PostToConnection`, deliberately **not** by returning a body. A body
 * returned from a WebSocket route is silently discarded unless that route has an integration response
 * configured — the classic API Gateway WebSocket footgun, which presents as "my pong never arrives"
 * with nothing in the logs. Replying through the management API means there is exactly one mechanism
 * by which a frame ever reaches a client, the same one fan-out uses.
 */
export const defaultRoute = async (event: WebSocketEvent): Promise<APIGatewayProxyResult> => {
	const { connectionId, domainName, stage } = event.requestContext;

	let message: WebSocketClientMessage = {};
	try {
		message = event.body ? (JSON.parse(event.body) as WebSocketClientMessage) : {};
	} catch {
		// A client that sends garbage gets a no-op rather than an error frame. Nothing depends on
		// inbound messages, so there is no failure worth reporting back.
		message = {};
	}

	if (message.action !== "ping") {
		await CWLogger.CAction(2, FUNC_NAMES.REALTIME_MGR, {
			userId: null,
			action: "ws-message-ignored",
			resource: null,
			details: { connectionId, receivedAction: message.action ?? null },
		});
		return { statusCode: 200, body: "" };
	}

	await RealtimeConnections.Touch(connectionId);

	const AGM = new ApiGatewayManagementDao();
	const result = await AGM.PostToConnection(`https://${domainName}/${stage}`, connectionId, {
		type: "pong",
		at: Date.now(),
	});

	if (result === "gone") {
		await RealtimeConnections.Delete(connectionId);
	}

	return { statusCode: 200, body: "" };
};
