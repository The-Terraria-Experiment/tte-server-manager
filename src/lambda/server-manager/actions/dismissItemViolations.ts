import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Realtime } from "../shared/utils/realtime/RealtimePublisher.js";
import { dismissViolations, readScanState } from "../shared/utils/jobs/ItemRuleScan.js";

/**
 * Clears item rule violations an operator has dealt with.
 *
 * Nothing else clears a flag except the flagged player joining again without the offending items.
 * That is on purpose — if disconnecting cleared it, the flag would be trivially self-erasable by the
 * one person with a motive — but on its own it means a player who is dealt with and never returns
 * stays on the tile permanently. This is the way out.
 *
 * Deliberately *not* a rules-write operation. Editing what the server forbids and clearing a report
 * that someone broke the old rules are different jobs, and an operator who moderates players is not
 * necessarily one who sets policy.
 */

/** Bounds one request. The violation map itself is capped at `PLAYER_VIOLATION_CAP` (50). */
const MAX_DISMISS = 100;

export const dismissItemViolations = async (
	event: AuthorizedEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	void context;

	const serverID = event.pathParameters?.id;
	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	const body = (event.parsedBody ?? {}) as { player?: unknown, players?: unknown, all?: unknown };

	const state = await readScanState(serverID);
	const flagged = state?.violations ?? {};

	// Resolved to the concrete names that are flagged *now*, including for "dismiss all". The write
	// then removes those players individually, so a violation raised between this read and that write
	// survives rather than being erased by a blanket overwrite of the map.
	let requested: string[];
	if (body.all === true) {
		requested = Object.keys(flagged);
	} else if (Array.isArray(body.players)) {
		requested = body.players.filter((player): player is string => typeof player === "string" && player.length > 0);
	} else if (typeof body.player === "string" && body.player.length > 0) {
		requested = [body.player];
	} else {
		return ResponseUtil.ValidationError("A player name, a players array, or all: true is required");
	}

	if (requested.length > MAX_DISMISS) {
		return ResponseUtil.ValidationError(`At most ${MAX_DISMISS} players can be dismissed at once`);
	}

	// Nothing flagged, or nothing named that is flagged. Not an error — two operators clearing the
	// same tile is an ordinary race, and the second one should see success, not a failure for having
	// been slower.
	if (!requested.length) {
		return ResponseUtil.Success({ dismissed: [], remaining: Object.keys(flagged).length });
	}

	const dismissed = await dismissViolations(serverID, requested);
	const remaining = Object.keys(flagged).filter(player => !dismissed.includes(player)).length;

	const dismissedBy = Parsers.GetUserSub(event) ?? "unknown";

	// After the write, and only when something actually changed — a dismissal that removed nothing
	// would otherwise cost every open browser a refetch for no visible difference.
	if (dismissed.length) {
		await Realtime.PublishServerViolations(serverID, String(remaining));
	}

	CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: dismissedBy,
		action: "dismiss-item-violations",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		// Player names are already recorded on the row this clears, and who cleared what is the point
		// of logging a moderation action at all.
		details: { serverID, requested: requested.length, dismissed, remaining },
	});

	return ResponseUtil.Success({ dismissed, remaining });
};
