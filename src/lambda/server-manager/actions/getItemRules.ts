import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { readItemRules } from "../shared/utils/jobs/ItemRuleScan.js";
import { DEFAULT_KICK_REASON } from "../shared/utils/jobs/ItemRuleShape.js";
import { SNAPSHOT_GROUPS } from "../shared/utils/tshock/InventorySnapshots.js";

/**
 * Reads an instance's item rule list.
 *
 * `configured` is reported separately because the defaults below are *fabricated* for an instance
 * that has never had rules — without the flag, "blacklist, enabled: false, no entries" is
 * indistinguishable from an operator having deliberately set exactly that. The metrics config
 * endpoint carries the same flag for the same reason.
 */
export const getItemRules = async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	const stored = await readItemRules(serverID);

	// Entries carry only ids and whatever label the editor saved with them. Resolving an id to a
	// display name is the frontend's job, from the item-name map published alongside the sprite atlas
	// — the backend has no name table and no business fetching one on this path.
	const entries = stored?.entries ?? [];

	return ResponseUtil.Success({
		configured: Boolean(stored),
		rules: {
			enabled: stored?.enabled ?? false,
			mode: stored?.mode ?? "blacklist",
			groups: stored?.groups?.length ? stored.groups : [...SNAPSHOT_GROUPS],
			entries,
			// Off by default, and fabricated like everything else here for an unconfigured instance — the
			// `configured` flag above is what tells the editor these are defaults rather than choices.
			enforcement: {
				kick: stored?.enforcement?.kick ?? false,
				kickReason: stored?.enforcement?.kickReason || DEFAULT_KICK_REASON,
			},
			updatedAt: stored?.updatedAt ?? null,
			updatedBy: stored?.updatedBy ?? null,
		},
	});
};
