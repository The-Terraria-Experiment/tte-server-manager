import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { HmacToken, type HmacTokenPayload } from "../shared/utils/core/HmacToken.js";
import { SecretsManagerDao } from "../shared/aws/SecretsManager.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { PATREON_SHIM_BASE_URL } from "../shared/vars.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";

interface LinkIntentPayload extends HmacTokenPayload {
	username: string;
	sub: string;
}

const LINK_INTENT_TTL_MS = 5 * 60 * 1000;

export const patreonLinkStart = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const sub = Parsers.GetUserSub(event);
	const username = event.requestContext?.authorizer?.["claims.cognito:username"];

	if (!sub || !username) {
		return ResponseUtil.PermissionDeniedError("Unable to resolve current user");
	}

	const secretName = process.env.LINK_INTENT_SECRET_NAME;
	if (!PATREON_SHIM_BASE_URL || !secretName) {
		return ResponseUtil.Error("Patreon linking is not configured", 500, "CONFIGURATION_ERROR");
	}

	const secret = await new SecretsManagerDao().GetSecret(secretName);
	if (!secret) {
		return ResponseUtil.Error("Patreon linking is not configured", 500, "CONFIGURATION_ERROR");
	}

	const linkIntent = HmacToken.Sign<LinkIntentPayload>(
		{ username, sub, exp: Date.now() + LINK_INTENT_TTL_MS },
		secret,
	);

	const authorizeUrl = new URL(`${PATREON_SHIM_BASE_URL}/authorize`);
	authorizeUrl.searchParams.set("mode", "link");
	authorizeUrl.searchParams.set("link_intent", linkIntent);

	await CWLogger.Action(FUNC_NAMES.USER_MGR, {
		userId: sub,
		action: "patreon-link-start",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
	});

	return ResponseUtil.Success({ authorizeUrl: authorizeUrl.toString() });
};
