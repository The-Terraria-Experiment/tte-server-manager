import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { RealtimeTicket } from "../shared/utils/realtime/RealtimeTicket.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";

/**
 * Issues a short-lived ticket that authenticates a WebSocket handshake.
 *
 * This exists because a browser cannot set headers on a WebSocket handshake, so the credential must
 * travel in the query string — and a Cognito ID token there would be a one-hour, full-API bearer token
 * written into every surface that records a request URI. The client trades its token for a 30-second
 * ticket here, over the ordinary authenticated path, and `$connect` verifies that instead.
 *
 * Gated on `PERMISSIONS.access` — the site-access gate. There is deliberately no dedicated "may use
 * the socket" permission: being authenticated is what gates connecting, and per-resource access is
 * already enforced on every refetch an event triggers. A separate permission would need mirroring
 * across three files and would produce users who can read a page but never see it update.
 */
export const createRealtimeTicket = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const userSub = Parsers.GetUserSub(event);
	if (!userSub) {
		return ResponseUtil.PermissionDeniedError("Unauthorized: No user context");
	}

	try {
		const ticket = await RealtimeTicket.Sign(userSub);

		await CWLogger.CAction(2, FUNC_NAMES.SYS_MGR, {
			userId: userSub,
			action: "realtime-ticket",
			resource: null,
			// Never the ticket itself: it is a credential, however brief.
			details: { lifetimeMs: RealtimeTicket.LifetimeMs },
		});

		return ResponseUtil.Success({ ticket, expiresInMs: RealtimeTicket.LifetimeMs });
	} catch (error: any) {
		await CWLogger.Error(FUNC_NAMES.SYS_MGR, {
			error: error?.message ?? "Failed to issue realtime ticket",
			stack: error?.stack,
			details: { action: "realtime-ticket", userId: userSub },
		});

		// A missing secret or a Secrets Manager failure is a server-side misconfiguration, not the
		// caller's problem. Generic message: the client's only sane response is to fall back to polling.
		return ResponseUtil.Error("Could not issue a realtime ticket", 500, "REALTIME_TICKET_FAILED");
	}
};
