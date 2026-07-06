import { timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { SecretsManagerDao } from "../shared/aws/SecretsManager.js";
import { PATREON_OIDC_ISSUER_URL } from "../shared/vars.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { consumeCode } from "../lib/ephemeralCode.js";
import { signAccessToken, signIdToken } from "../lib/signing.js";

interface ShimTokenClientCreds {
	clientId: string;
	clientSecret: string;
}

interface ClientCredentials {
	clientId: string;
	clientSecret: string;
}

function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * Cognito authenticates to this endpoint with either client_secret_basic (Authorization header)
 * or client_secret_post (client_id/client_secret as body params) depending on its own defaults -
 * observed in practice to use the body form here - so both must be accepted.
 */
function parseClientCredentials(event: APIGatewayProxyEvent, body: URLSearchParams): ClientCredentials | null {
	const authHeader = event.headers?.authorization || event.headers?.Authorization;
	if (authHeader?.startsWith("Basic ")) {
		const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
		const separatorIndex = decoded.indexOf(":");
		if (separatorIndex === -1) return null;

		return {
			clientId: decoded.slice(0, separatorIndex),
			clientSecret: decoded.slice(separatorIndex + 1),
		};
	}

	const clientId = body.get("client_id");
	const clientSecret = body.get("client_secret");
	if (!clientId || !clientSecret) return null;

	return { clientId, clientSecret };
}

async function verifyClientCredentials(creds: ClientCredentials): Promise<boolean> {
	const secretName = process.env.SHIM_TOKEN_CREDS_SECRET_NAME;
	if (!secretName) return false;

	const raw = await new SecretsManagerDao().GetSecret(secretName);
	if (!raw) return false;

	const expected = JSON.parse(raw) as ShimTokenClientCreds;
	return safeEqual(creds.clientId, expected.clientId) && safeEqual(creds.clientSecret, expected.clientSecret);
}

export const token = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const body = new URLSearchParams(event.body || "");
	const creds = parseClientCredentials(event, body);
	if (!creds || !(await verifyClientCredentials(creds))) {
		return ResponseUtil.Error("Invalid client credentials", 401, "INVALID_CLIENT");
	}

	const grantType = body.get("grant_type");
	const code = body.get("code");

	if (grantType !== "authorization_code" || !code) {
		return ResponseUtil.ValidationError("Unsupported or missing grant_type/code");
	}

	const identity = await consumeCode(code);
	if (!identity) {
		return ResponseUtil.Error("Invalid or expired code", 400, "INVALID_GRANT");
	}

	const issuer = PATREON_OIDC_ISSUER_URL;
	if (!issuer) {
		return ResponseUtil.Error("Patreon OIDC shim is not configured", 500, "CONFIGURATION_ERROR");
	}

	const sub = `patreon_${identity.patreonUserId}`;

	const idToken = await signIdToken({
		sub,
		email: identity.email,
		emailVerified: identity.emailVerified,
		tierIds: identity.tierIds,
		audience: creds.clientId,
		issuer,
	});

	const accessToken = await signAccessToken({
		sub,
		email: identity.email,
		emailVerified: identity.emailVerified,
		tierIds: identity.tierIds,
		issuer,
	});

	return ResponseUtil.Success({
		access_token: accessToken,
		id_token: idToken,
		token_type: "Bearer",
		expires_in: 3600,
	});
};
