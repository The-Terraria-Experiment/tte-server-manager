import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { TShockAPI } from "../shared/utils/tshock/TShockAPI.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";

export const dropCache = async (event: AuthorizedEvent, context: Context) => {
	void context;

	// Drops this container's cached REST credential, so a rotated secret is picked up without waiting
	// for the container to recycle. TShock tokens are not cached here — they live in tshock-proxy
	// containers, which nothing can clear on demand; the 403 re-mint in TShockDirect.Request is what
	// recovers from a stale token.
	TShockAPI.DropCredentialCache();

	await CWLogger.CAction(4, FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "drop-user-cache",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: {},
	});

	return ResponseUtil.Success({ message: "Cache dropped" });
};
