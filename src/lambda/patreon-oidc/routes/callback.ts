import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { HmacToken } from "../shared/utils/core/HmacToken.js";
import { SecretsManagerDao } from "../shared/aws/SecretsManager.js";
import { CognitoDao } from "../shared/aws/Cognito.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { COGNITO_USER_POOL_ID, PATREON_LINK_APP_ORIGIN, PATREON_OIDC_ISSUER_URL, PERM_TABLE } from "../shared/vars.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { exchangePatreonCode, fetchPatreonIdentity, toPatreonSub } from "../lib/patreonClient.js";
import { createCode } from "../lib/ephemeralCode.js";
import { loadPatreonCreds } from "../lib/patreonCreds.js";
import type { FederationRelayState, LinkRelayState } from "./relayStateTypes.js";

function redirectTo(location: string): APIGatewayProxyResult {
	return { statusCode: 302, headers: { Location: location }, body: "" };
}

/**
 * Per Patreon's integration requirements, a patron with an unverified Patreon email must never
 * be allowed to sign up, log in, or link via Patreon - thrown before any Cognito call is made,
 * for both the federation and manual-link modes.
 */
class PatreonEmailUnverifiedError extends Error {
	constructor() {
		super("Patreon email is not verified");
		this.name = "PatreonEmailUnverifiedError";
	}
}

export const callback = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const query = event.queryStringParameters || {};
	const relaySecretName = process.env.RELAY_STATE_SECRET_NAME;

	if (!query.state || !relaySecretName) {
		// No state at all means Patreon bounced the user here directly, without ever completing
		// its own redirect - observed when Patreon's own "verify your email" interstitial gates
		// authorization before the OAuth dance even starts. There's no relay payload to recover a
		// Cognito/link target from, but PATREON_LINK_APP_ORIGIN is a fixed, trusted env var (never
		// derived from this request), so redirecting there is safe even though state is missing.
		if (!PATREON_LINK_APP_ORIGIN) {
			return ResponseUtil.ValidationError("Missing state");
		}

		return redirectTo(`${PATREON_LINK_APP_ORIGIN}/?patreonError=missing_state`);
	}

	const relaySecret = await new SecretsManagerDao().GetSecret(relaySecretName);
	const relayPayload = relaySecret
		? HmacToken.Verify<FederationRelayState | LinkRelayState>(query.state, relaySecret)
		: null;

	if (!relayPayload) {
		// No verified relay state means we have no safe target to bounce the user back to.
		return ResponseUtil.ValidationError("Invalid or expired state");
	}

	try {
		if (query.error) {
			throw new Error(`Patreon denied authorization: ${query.error}`);
		}

		const code = query.code;
		if (!code) {
			throw new Error("Missing code from Patreon");
		}

		const shimBaseUrl = PATREON_OIDC_ISSUER_URL;
		if (!shimBaseUrl) {
			throw new Error("Patreon OIDC shim is not configured");
		}

		const patreonCreds = await loadPatreonCreds();
		if (!patreonCreds) {
			throw new Error("Patreon OIDC shim is not configured");
		}

		const accessToken = await exchangePatreonCode(
			code,
			`${shimBaseUrl}/callback`,
			patreonCreds.clientId,
			patreonCreds.clientSecret,
		);
		const identity = await fetchPatreonIdentity(accessToken);

		if (!identity.email || !identity.emailVerified) {
			throw new PatreonEmailUnverifiedError();
		}

		if (relayPayload.mode === "federation") {
			const opaqueCode = await createCode({
				patreonUserId: identity.patreonUserId,
				email: identity.email,
				emailVerified: identity.emailVerified,
				tierIds: identity.tierIds,
			});

			const redirectUrl = new URL(relayPayload.cognitoRedirectUri);
			redirectUrl.searchParams.set("code", opaqueCode);
			redirectUrl.searchParams.set("state", relayPayload.cognitoState);

			return redirectTo(redirectUrl.toString());
		}

		if (!COGNITO_USER_POOL_ID) {
			throw new Error("Cognito user pool is not configured");
		}

		const linked = await new CognitoDao().AdminLinkProviderForUser(
			COGNITO_USER_POOL_ID,
			relayPayload.username,
			"Patreon",
			toPatreonSub(identity.patreonUserId),
		);

		if (linked) {
			await new DynamoDao().UpdateItem(PERM_TABLE, `user#${relayPayload.sub}`, {
				updates: { patreonLinked: true },
			});
		}

		const appOrigin = PATREON_LINK_APP_ORIGIN;
		if (!appOrigin) {
			throw new Error("APP_ORIGIN is not configured");
		}

		return redirectTo(`${appOrigin}/overview?patreonLinked=${linked ? "true" : "false"}`);
	} catch (error) {
		await CWLogger.Error(FUNC_NAMES.PATREON_OIDC, {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});

		const emailUnverified = error instanceof PatreonEmailUnverifiedError;

		if (relayPayload.mode === "federation") {
			const failureUrl = new URL(relayPayload.cognitoRedirectUri);
			failureUrl.searchParams.set("error", "access_denied");
			failureUrl.searchParams.set("error_description", emailUnverified ? "patreon_email_unverified" : "sign_in_failed");
			failureUrl.searchParams.set("state", relayPayload.cognitoState);
			return redirectTo(failureUrl.toString());
		}

		const reason = emailUnverified ? "&reason=patreon_email_unverified" : "";
		return redirectTo(`${PATREON_LINK_APP_ORIGIN || ""}/overview?patreonLinked=false${reason}`);
	}
};
