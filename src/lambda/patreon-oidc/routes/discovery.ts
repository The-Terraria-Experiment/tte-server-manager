import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { PATREON_OIDC_ISSUER_URL } from "../shared/vars.js";

export const discovery = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void event;
	void context;

	const issuer = PATREON_OIDC_ISSUER_URL;
	if (!issuer) {
		return ResponseUtil.Error("Patreon OIDC shim is not configured", 500, "CONFIGURATION_ERROR");
	}

	return ResponseUtil.Success({
		issuer,
		authorization_endpoint: `${issuer}/authorize`,
		token_endpoint: `${issuer}/token`,
		jwks_uri: `${issuer}/jwks`,
		userinfo_endpoint: `${issuer}/userinfo`,
		response_types_supported: ["code"],
		subject_types_supported: ["public"],
		id_token_signing_alg_values_supported: ["RS256"],
		scopes_supported: ["openid", "email"],
		claims_supported: ["sub", "email", "email_verified", "patreon_tier_ids"],
	});
};
