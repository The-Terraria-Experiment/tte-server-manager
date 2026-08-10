/**
 * Minimal OIDC-compliant shim exposing Patreon's OAuth2 API as a Cognito-compatible
 * external identity provider. Unlike the other manager Lambdas, this function is
 * called by Cognito (server-to-server), Patreon (redirect), and unauthenticated
 * browsers - not by our own authenticated frontend - so it routes on raw HTTP
 * method+resource without the shared action/permission-checking middleware, and
 * does not JSON-parse the request body (the /token route is form-urlencoded).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { createHandler } from "./shared/middleware/createHandler.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { ResponseUtil } from "./shared/utils/core/APIResponse.js";
import { authorize } from "./routes/authorize.js";
import { callback } from "./routes/callback.js";
import { token } from "./routes/token.js";
import { jwks } from "./routes/jwks.js";
import { discovery } from "./routes/discovery.js";
import { userinfo } from "./routes/userinfo.js";

type RouteHandler = (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

const routes: Record<string, RouteHandler> = {
	"GET /authorize": authorize,
	"GET /callback": callback,
	"POST /token": token,
	"GET /jwks": jwks,
	"GET /userinfo": userinfo,
	"GET /.well-known/openid-configuration": discovery,
};

const h = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
	const { httpMethod, resource } = event;
	// API Gateway mounts this shim's routes under /auth/patreon/* within the shared REST API
	// rather than at its own root, so the matched resource template carries that prefix.
	const routePath = resource.replace(/^\/auth\/patreon/, "") || "/";
	const routeKey = `${httpMethod} ${routePath}`;

	await CWLogger.Action(FUNC_NAMES.PATREON_OIDC, {
		action: "invoke",
		resource: routeKey,
	});

	const routeHandler = routes[routeKey];
	if (!routeHandler) {
		return ResponseUtil.NotFoundError("Route");
	}

	const result = await routeHandler(event, context);

	await CWLogger.FlushAll();

	return result;
};

export const handler = createHandler(h);
