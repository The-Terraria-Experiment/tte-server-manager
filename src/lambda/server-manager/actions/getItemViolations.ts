import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { readScanState } from "../shared/utils/jobs/ItemRuleScan.js";

/**
 * Reads the current violation set for an instance.
 *
 * A pure Dynamo read — it never touches the game server, which is what makes it safe as the target
 * of a socket-driven refetch. The scan that produces this data is the thing that costs a TShock
 * round trip, and that happens once per join regardless of how many browsers are watching.
 */
export const getItemViolations = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	const state = await readScanState(serverID);

	return ResponseUtil.Success({
		violations: state?.violations ?? {},
		lastScanAt: state?.lastScanAt ?? null,
		lastScanStatus: state?.lastScanStatus ?? null,
	});
};
