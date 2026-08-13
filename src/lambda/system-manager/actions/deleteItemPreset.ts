import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { itemPresetKey } from "../shared/utils/jobs/ItemPresets.js";

/**
 * Removes a preset from the library.
 *
 * Servers that loaded it keep their rules untouched — applying a preset copies it, so there is
 * nothing to cascade and no server to check before deleting.
 */
export const deleteItemPreset = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const presetId = event.pathParameters?.presetId;
	if (!presetId) {
		return ResponseUtil.ValidationError("Preset ID is required");
	}

	await new DynamoDao().DeleteItem(SYSTEM_TABLE, itemPresetKey(presetId));

	await CWLogger.Action(FUNC_NAMES.SYS_MGR, {
		userId: Parsers.GetUserSub(event) ?? "unknown",
		action: "delete-item-preset",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { presetId },
	});

	return ResponseUtil.Success({ presetId });
};
