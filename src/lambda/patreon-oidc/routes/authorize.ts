import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { HmacToken } from "../shared/utils/core/HmacToken.js";
import { SecretsManagerDao } from "../shared/aws/SecretsManager.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { loadPatreonCreds } from "../lib/patreonCreds.js";
import { PATREON_OIDC_ISSUER_URL } from "../shared/vars.js";
import type { FederationRelayState, LinkIntentPayload, LinkRelayState } from "./relayStateTypes.js";

const RELAY_STATE_TTL_MS = 5 * 60 * 1000;
const PATREON_SCOPES = "identity identity[email] identity.memberships";

/**
 * Reduces a redirect URI to the parts that must match exactly, so that trivia like a trailing
 * slash or host casing can't cause a false reject. Anything non-HTTPS or unparseable is
 * rejected outright, which also rules out `javascript:`/`data:` targets.
 */
function normalizeRedirectUri(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return null;

		return `https://${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
	} catch {
		return null;
	}
}

/**
 * `redirect_uri` arrives as an untrusted query param and callback.ts later echoes the Patreon
 * authorization code to it. Without an allowlist this route is an open redirect that hands a
 * victim's code to any attacker-chosen URL, so only our own User Pools' hosted-UI endpoints
 * are accepted. Fails closed: an unset allowlist rejects every federation attempt rather than
 * silently reverting to "trust whatever was passed".
 */
function isAllowedCognitoRedirectUri(candidate: string): boolean {
	const normalizedCandidate = normalizeRedirectUri(candidate);
	if (!normalizedCandidate) return false;

	return (process.env.ALLOWED_COGNITO_REDIRECT_URIS || "")
		.split(",")
		.map((entry) => normalizeRedirectUri(entry.trim()))
		.some((entry) => entry !== null && entry === normalizedCandidate);
}

export const authorize = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const query = event.queryStringParameters || {};
	const relaySecretName = process.env.RELAY_STATE_SECRET_NAME;
	const shimBaseUrl = PATREON_OIDC_ISSUER_URL;

	if (!relaySecretName || !shimBaseUrl) {
		return ResponseUtil.Error("Patreon OIDC shim is not configured", 500, "CONFIGURATION_ERROR");
	}

	const patreonCreds = await loadPatreonCreds();
	if (!patreonCreds) {
		return ResponseUtil.Error("Patreon OIDC shim is not configured", 500, "CONFIGURATION_ERROR");
	}

	const relaySecret = await new SecretsManagerDao().GetSecret(relaySecretName);
	if (!relaySecret) {
		return ResponseUtil.Error("Patreon OIDC shim is not configured", 500, "CONFIGURATION_ERROR");
	}

	let relayPayload: FederationRelayState | LinkRelayState;

	if (query.mode === "link") {
		const linkIntentSecretName = process.env.LINK_INTENT_SECRET_NAME;
		if (!query.link_intent || !linkIntentSecretName) {
			return ResponseUtil.ValidationError("Missing link_intent");
		}

		const linkIntentSecret = await new SecretsManagerDao().GetSecret(linkIntentSecretName);
		const linkIntent = linkIntentSecret
			? HmacToken.Verify<LinkIntentPayload>(query.link_intent, linkIntentSecret)
			: null;

		if (!linkIntent) {
			return ResponseUtil.ValidationError("Invalid or expired link_intent");
		}

		relayPayload = {
			mode: "link",
			username: linkIntent.username,
			sub: linkIntent.sub,
			exp: Date.now() + RELAY_STATE_TTL_MS,
		};
	} else {
		const cognitoState = query.state;
		const cognitoRedirectUri = query.redirect_uri;

		if (!cognitoState || !cognitoRedirectUri) {
			return ResponseUtil.ValidationError("Missing state or redirect_uri");
		}

		if (!isAllowedCognitoRedirectUri(cognitoRedirectUri)) {
			// Either a misconfigured pool or someone probing for an open redirect - worth a log
			// line either way, since a legitimate caller can only ever send an allowlisted value.
			await CWLogger.Error(FUNC_NAMES.PATREON_OIDC, {
				error: "Rejected unrecognized redirect_uri",
				details: { redirectUri: cognitoRedirectUri },
			});

			return ResponseUtil.ValidationError("Unrecognized redirect_uri");
		}

		relayPayload = {
			mode: "federation",
			cognitoState,
			cognitoRedirectUri,
			exp: Date.now() + RELAY_STATE_TTL_MS,
		};
	}

	const relayState = HmacToken.Sign(relayPayload, relaySecret);

	const patreonAuthorizeUrl = new URL("https://www.patreon.com/oauth2/authorize");
	patreonAuthorizeUrl.searchParams.set("response_type", "code");
	patreonAuthorizeUrl.searchParams.set("client_id", patreonCreds.clientId);
	patreonAuthorizeUrl.searchParams.set("redirect_uri", `${shimBaseUrl}/callback`);
	patreonAuthorizeUrl.searchParams.set("scope", PATREON_SCOPES);
	patreonAuthorizeUrl.searchParams.set("state", relayState);

	return {
		statusCode: 302,
		headers: { Location: patreonAuthorizeUrl.toString() },
		body: "",
	};
};
