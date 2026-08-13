import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { LambdaDao } from "../shared/aws/Lambda.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import {
	hasActiveRules,
	readItemRules,
	INVENTORY_SCAN_REQUEST_TYPE,
	type InventoryScanRequestData,
} from "../shared/utils/jobs/ItemRuleScan.js";

/**
 * Queues an out-of-band drain — the Scan now button.
 *
 * The event-driven path covers the normal case, but not two of them: a rules change an operator
 * wants applied to whoever is already online, and a snapshot missed because an invoke was dropped.
 * This is the same worker either way, so it inherits the lease and simply folds into a drain that is
 * already running.
 */
export const queueItemScan = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	// Refused rather than queued-and-silently-dropped: the button is on the rules tile, so "I pressed
	// scan and nothing happened" needs to name the reason.
	const rules = await readItemRules(serverID);
	if (!hasActiveRules(rules)) {
		return ResponseUtil.Error(
			"Item rules are not enabled, or the list is empty",
			409,
			"RULES_INACTIVE",
		);
	}

	const requestedBy = Parsers.GetUserSub(event) ?? "unknown";

	const payload: InventoryScanRequestData = {
		requestType: INVENTORY_SCAN_REQUEST_TYPE,
		instanceID: serverID,
		requestedBy,
		reason: "manual",
	};

	// Targeted at the alias this request arrived on. Unqualified, the invoke lands on $LATEST, whose
	// ACTIVE_ENV is whichever branch deployed last — which decides both the table the cursor lives in
	// and the instance the drain talks to.
	await new LambdaDao().InvokeFunction(payload, context.invokedFunctionArn);

	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: requestedBy,
		action: "queue-inventory-scan",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { serverID },
	});

	return ResponseUtil.Success({ queued: true });
};
