import { HttpMethod, Network, type RequestResponse } from "../core/Network.js";
import { redactCredentials } from "../core/Redact.js";
import type { TShockCredential, TShockProxyRequest, TShockProxyResponse } from "./TShockProxy.js";

/**
 * TShock's REST replies carry the HTTP code again as a string in the body (`{"status":"200",…}`) —
 * see `PlayerData.status` in server-manager's managePlayer, and `serverStore`'s `status === "200"`
 * check. Which of the two is authoritative on an *auth* failure isn't something this repo has ever
 * had to establish, because nothing else inspects the body-level code. Rather than bet on one, the
 * token-rejection test below reads both.
 */
function isTokenRejection(response: RequestResponse): boolean {
	if (response.statusCode === 401 || response.statusCode === 403) {
		return true;
	}
	const bodyStatus = response.json?.status;
	return bodyStatus === "401" || bodyStatus === "403";
}

/**
 * The half of the TShock REST client that actually speaks HTTP. This runs **only inside the
 * `tshock-proxy` lambda**, which is the only thing on the network that can reach the instances'
 * REST port; `TShockAPI` is the caller-side half that hands work to it.
 *
 * Logging here is `console.log`, deliberately, not `CWLogger`. `CWLogger` writes through the
 * CloudWatch Logs SDK to custom log groups — an AWS API call, which from a VPC-attached lambda with
 * no internet route and no interface endpoint would hang until the invocation timed out.
 * `console.log` is collected by the Lambda service itself and never touches the function's ENI.
 */
export class TShockDirect {
	/**
	 * Address → token, held for the life of the container with **no expiry**.
	 *
	 * This used to carry a self-imposed 5-minute TTL, which was pure waste: TShock does not expire
	 * REST tokens, so every mint stays valid until the server restarts, and discarding a working token
	 * on a timer just bought an extra round trip on the hot path plus another permanent entry in
	 * TShock's in-memory token table. The tokens the old code abandoned were never cleaned up by
	 * anyone — they accumulated for the life of the server.
	 *
	 * Dropping the TTL is only safe because rejection is now handled reactively: a rejected token is
	 * re-minted and the call retried once. That covers the one thing that genuinely invalidates a
	 * token — a server restart — and it covers it precisely, instead of guessing on a timer.
	 */
	private static readonly tokenCache = new Map<string, string>();

	private readonly ip!: string;
	private readonly port!: string;

	constructor(address: string, port: string) {
		this.ip = address;
		this.port = port;
	}

	/**
	 * Runs one TShock REST call, minting and caching a token as needed.
	 *
	 * A rejected token costs one retry with a freshly minted one. This is the *entire* invalidation
	 * strategy — there is no TTL and nothing proactively re-mints, because a server restart is the
	 * only thing that invalidates a token and a restart is exactly what this detects. It also replaces
	 * the old `DropTokenCache` hook, which could only ever clear the one container it ran in and so
	 * was unreliable by construction.
	 *
	 * The retry is deliberately not narrowed to "definitely an auth failure": a permission-denied 403
	 * will also spend one wasted mint here. That is a rare, already-failing path, and being wrong in
	 * that direction costs a round trip, whereas being too narrow would leave a restarted server
	 * unreachable until its containers recycled.
	 */
	public async Request(request: TShockProxyRequest): Promise<TShockProxyResponse> {
		try {
			let response = await this.send(request, await this.getAuthToken(request.credential, false));

			if (isTokenRejection(response)) {
				console.log(JSON.stringify({
					action: "tshock-token-rejected-retry",
					address: this.ip,
					endpoint: request.endpoint,
					httpStatus: response.statusCode,
					bodyStatus: response.json?.status ?? null,
					note: "token rejected; re-minting and retrying once",
				}));
				response = await this.send(request, await this.getAuthToken(request.credential, true));
			}

			if (response.statusCode < 200 || response.statusCode >= 300) {
				const message = response.json?.message || "TShock API error";
				return { ok: false, reason: "error", message: `TShock HTTP ${response.statusCode}: ${message}` };
			}

			return { ok: true, statusCode: response.statusCode, json: response.json };
		} catch (e: any) {
			const message = redactCredentials(e?.message ?? "unknown");

			// Both the token mint and the call itself land here when the box is up but TShock isn't.
			// The caller turns this into "server offline", so it must stay distinguishable from a
			// genuine fault.
			if (message.includes("ECONNREFUSED")) {
				return { ok: false, reason: "connection-refused" };
			}

			console.log(JSON.stringify({
				action: "tshock-call-failed",
				address: this.ip,
				endpoint: request.endpoint,
				method: request.method,
				error: message,
			}));

			return { ok: false, reason: "error", message };
		}
	}

	private async send(request: TShockProxyRequest, token: string): Promise<RequestResponse> {
		const urlParams = new URLSearchParams();
		urlParams.set("token", token);
		if (request.params) {
			for (const [key, value] of Object.entries(request.params)) {
				if (value === undefined) {
					continue;
				}
				urlParams.set(key, value);
			}
		}

		const url = `http://${this.ip}:${this.port}${request.endpoint}?${urlParams.toString()}`;
		const startedAt = Date.now();

		const response = await Network.HTTPJsonRequest(url, {
			method: request.method,
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json",
			},
			timeout: 5000,
		}, null);

		console.log(JSON.stringify({
			action: "tshock-response",
			address: this.ip,
			userID: request.userID,
			endpoint: request.endpoint,
			method: request.method,
			statusCode: response.statusCode,
			durationMs: Date.now() - startedAt,
		}));

		return response;
	}

	private async getAuthToken(credential: TShockCredential, forceRefresh: boolean): Promise<string> {
		if (!forceRefresh) {
			const cached = TShockDirect.tokenCache.get(this.ip);
			if (cached) {
				return cached;
			}
		}

		const minted = await this.createNewToken(credential);
		TShockDirect.tokenCache.set(this.ip, minted);
		return minted;
	}

	private async createNewToken(credential: TShockCredential): Promise<string> {
		const base = `http://${this.ip}:${this.port}`;
		const endpoint = "/v2/token/create";

		// TShock's token endpoint only accepts the login pair as query parameters, so this URL
		// carries a live credential. It must never be logged or put in an error message
		// un-redacted — see `redactCredentials`, which `Network` applies to anything it names.
		const params = `?username=${encodeURIComponent(credential.username)}&password=${encodeURIComponent(credential.password)}`;
		// Same explicit timeout as a normal call. Token acquisition sits in front of every other
		// TShock call, so an unbounded wait here stalls whatever the caller was actually trying to do.
		const { statusCode, json } = await Network.HTTPJsonRequest(
			`${base}${endpoint}${params}`,
			{ method: HttpMethod.GET, headers: { "Accept": "application/json" }, timeout: 5000 },
		);

		if (statusCode >= 200 && statusCode < 300 && json.token) {
			return json.token;
		}

		console.log(JSON.stringify({
			action: "tshock-create-token-failed",
			statusCode,
			error: json.error || json.message || "[ unknown ]",
		}));

		throw new Error("Failed to create TShock token");
	}
}
