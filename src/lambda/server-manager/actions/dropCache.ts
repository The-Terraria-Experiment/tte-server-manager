import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { TShockAPI } from "../utils/TShockAPI.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

export const dropCache = async (event: AuthorizedEvent, context: Context) => {
	void context;

	TShockAPI.DropTokenCache();

	await CWLogger.CAction(4, FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "drop-user-cache",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: {},
	});

	return ResponseUtil.Success({ message: "Cache dropped" });
};
