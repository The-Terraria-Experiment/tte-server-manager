import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { verifyAccessToken } from "../lib/signing.js";

export const userinfo = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const authHeader = event.headers?.authorization || event.headers?.Authorization;
	const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
	if (!token) {
		return ResponseUtil.Error("Missing bearer token", 401, "INVALID_TOKEN");
	}

	const claims = await verifyAccessToken(token);
	if (!claims) {
		return ResponseUtil.Error("Invalid or expired access token", 401, "INVALID_TOKEN");
	}

	return ResponseUtil.Success({
		sub: claims.sub,
		email: claims.email,
		email_verified: claims.emailVerified,
		patreon_tier_ids: claims.tierIds.join(","),
	});
};
