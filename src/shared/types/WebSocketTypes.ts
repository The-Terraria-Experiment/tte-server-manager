/**
 * API Gateway WebSocket API event shapes.
 *
 * Declared locally rather than taken from `@types/aws-lambda` because the published
 * `APIGatewayProxyWebsocketEventV2` omits `queryStringParameters`, which is the only place a browser
 * can put a credential during a handshake — `new WebSocket(url, protocols)` is the entire client API,
 * so there is no way to set a header.
 *
 * Pure types, so this file belongs here and is only ever reached with `import type`.
 */

export type WebSocketRouteKey = "$connect" | "$disconnect" | "$default" | (string & {});

export type WebSocketRequestContext = {
	routeKey: WebSocketRouteKey;
	connectionId: string;
	/** `<apiId>.execute-api.<region>.amazonaws.com`, or the custom domain. */
	domainName: string;
	/** `prod` or `stage`. Combined with `domainName` to form the management API endpoint. */
	stage: string;
	eventType?: "CONNECT" | "DISCONNECT" | "MESSAGE";
	requestId?: string;
	connectedAt?: number;
	requestTimeEpoch?: number;
};

export type WebSocketEvent = {
	requestContext: WebSocketRequestContext;
	/** Present on `$connect`. Carries the connect ticket. Never log this object. */
	queryStringParameters?: Record<string, string | undefined> | null;
	headers?: Record<string, string | undefined> | null;
	/** Present on message routes. */
	body?: string | null;
	isBase64Encoded?: boolean;
};

/** Frames a client may send us. Kept deliberately tiny — this pipeline is one-directional otherwise. */
export type WebSocketClientMessage = {
	action?: string;
};
