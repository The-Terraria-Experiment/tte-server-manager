import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { CW_LOG_GENERAL } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Permissions } from "../shared/utils/Permissions.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

export const dropcache = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const cacheVersion = await Permissions.BumpPermissionCacheVersion();
	Permissions.dropCache();

	await CWLogger.CAction(4, CW_LOG_GENERAL, {
		userId: Parsers.GetUserSub(event),
		action: "drop-user-cache",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { cacheVersion },
	});

	return ResponseUtil.Success({ message: "Cache dropped", cacheVersion });
};
