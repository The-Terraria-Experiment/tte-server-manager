import { HmacToken, type HmacTokenPayload } from "../core/HmacToken.js";
import { SecretsManagerDao } from "../../aws/SecretsManager.js";
import { REALTIME_TICKET_SECRET_NAME } from "../../vars.js";
import { Assert } from "../core/Assert.js";

/**
 * Short-lived tickets that authenticate a WebSocket handshake.
 *
 * A browser cannot set headers on a WebSocket handshake, so the credential has to ride in the query
 * string. Putting the Cognito ID token there would place a one-hour, full-API bearer token into every
 * surface that records a request URI — API Gateway access logs, execution logs with data tracing, any
 * CDN or WAF in front — and keeping it out of all of them forever becomes a standing configuration
 * requirement that one debugging session can undo.
 *
 * So the query string carries a throwaway instead: the client trades its ID token for a 30-second
 * ticket over the ordinary authenticated REST path (`POST /realtime/ticket`, which therefore gets the
 * existing authorizer and permission check for free), and `$connect` verifies that. A ticket found in
 * a log is worthless thirty seconds later.
 *
 * Two consequences worth knowing:
 *
 * - **This is short-lived, not single-use.** True single-use would need a replay record written on
 *   every connect; not worth it, because a replayed ticket buys only a socket that delivers
 *   contentless "something changed" notifications.
 * - **No authorizer is involved.** `$connect` verifies inline and returns 401 itself, which is why
 *   this feature needed no change to `api-authorizer` and no second authorizer function.
 */

/** Long enough to cover a slow handshake, short enough that a leaked ticket is inert. */
const TICKET_LIFETIME_MS = 30 * 1000;

type RealtimeTicketPayload = HmacTokenPayload & {
	sub: string;
};

export class RealtimeTicket {
	/**
	 * Cached across warm invocations. Only a secret rotation invalidates it, and both signer and
	 * verifier are on request paths where a Secrets Manager round trip per call would be pure waste.
	 */
	private static secret: string | null = null;

	private static async GetSecret(): Promise<string> {
		if (RealtimeTicket.secret) {
			return RealtimeTicket.secret;
		}

		Assert.IsTruthyString(REALTIME_TICKET_SECRET_NAME, "REALTIME_TICKET_SECRET_NAME is required");

		const secrets = new SecretsManagerDao();
		const raw = await secrets.GetSecret(REALTIME_TICKET_SECRET_NAME!);
		Assert.IsTruthyString(raw, "Realtime ticket secret is empty");

		// Accept either a bare string secret or a single-key JSON object, since Secrets Manager's
		// console nudges you toward JSON and this is the kind of mismatch that fails at runtime only.
		let secret = raw!;
		try {
			const parsed = JSON.parse(raw!);
			if (parsed && typeof parsed === "object") {
				const first = Object.values(parsed as Record<string, unknown>)[0];
				if (typeof first === "string" && first) {
					secret = first;
				}
			}
		} catch {
			// Not JSON: the raw string is the secret.
		}

		RealtimeTicket.secret = secret;
		return secret;
	}

	public static async Sign(userSub: string): Promise<string> {
		Assert.IsTruthyString(userSub, "A user is required to issue a realtime ticket");

		const secret = await RealtimeTicket.GetSecret();
		return HmacToken.Sign<RealtimeTicketPayload>(
			{ sub: userSub, exp: Date.now() + TICKET_LIFETIME_MS },
			secret,
		);
	}

	/**
	 * Returns the Cognito sub the ticket was issued to, or null if it is missing, tampered with, or
	 * expired. `HmacToken.Verify` already does the expiry check and a timing-safe comparison.
	 */
	public static async VerifySub(ticket: string | undefined | null): Promise<string | null> {
		if (!ticket) {
			return null;
		}

		const secret = await RealtimeTicket.GetSecret();
		const payload = HmacToken.Verify<RealtimeTicketPayload>(ticket, secret);

		return payload?.sub || null;
	}

	/** For a secret rotation. */
	public static DropCache(): void {
		RealtimeTicket.secret = null;
	}

	public static get LifetimeMs(): number {
		return TICKET_LIFETIME_MS;
	}
}
