import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Assert } from "../shared/utils/Assert.js";
import { HttpMethod, Network, type RequestResponse } from "../shared/utils/Network.js";
import { SecretsManagerDao } from "../shared/aws/SecretsManager.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Parsers } from "../shared/utils/Parsers.js";

type TempToken = {
	token: string,
	expiresAtMs: number
};

type TokenData = TempToken & {
	source: string,
	cacheHit: boolean
}

/**
 * Note:
 * Perms required:
 * - tshock.rest.maintenance
 * - tshock.rest.useapi
 * - tshock.rest.cfg
 */

export class TShockAPI {
	private static readonly tokenCache = new Map<string, TempToken>();

	private readonly ip!: string

	constructor(serverAddress: string) {
		this.ip = serverAddress;
	}

	public async APIRequest(userID: string, endpoint: string, params: Record<string, any> | undefined = undefined, method: HttpMethod = HttpMethod.GET): Promise<Record<string, any>>
	{
		Assert.IsTruthyString(endpoint, "Missing endpoint for TShock API call");

		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "tshock-call-api",
			status: "pre-call",
			resource: null,
			details: { apiIP: this.ip, endpoint, method }
		});

		let token: TokenData;
		try {
			token = await this.getAuthToken();

			CWLogger.CAction(5, FUNC_NAMES.SERV_MGR, {
				userId: userID,
				action: "tshock-token-retrieved",
				status: "ok",
				details: {
					apiIP: this.ip,
					apiPort: process.env.TSHOCK_API_PORT,
					endpoint,
					tokenSource: token.source || "unknown",
					cacheHit: token.cacheHit,
					tokenExpiresAt: token.expiresAtMs,
					tokenExpiresIn: token.expiresAtMs - Date.now()
				}
			});
		} catch (e: any) {
			if (e?.message?.includes("ECONNREFUSED")) {
				CWLogger.CAction(5, FUNC_NAMES.SERV_MGR, {
					userId: userID,
					action: "tshock-conn-refused",
					status: 'token-request-refused',
					resource: null,
					details: {
						phase: 'token-acquire',
						fullMessage: e.message,
						target: {
							apiIP: this.ip,
							apiPort: process.env.TSHOCK_API_PORT,
							endpoint,
						},
					}
				});

				return ResponseUtil.Success({ server: { status: false } });
			} else {
				CWLogger.Error(FUNC_NAMES.SERV_MGR, {
					userId: userID,
					action: "tshock-get-token",
					error: e.message ?? "unknown",
					details: {
						target: {
							apiIP: this.ip,
							apiPort: process.env.TSHOCK_API_PORT,
							endpoint,
							method
						},
					}
				});
				throw e;
			}
		}

		const baseURL = `http://${this.ip}:${process.env.TSHOCK_API_PORT}`;

		const urlParams = new URLSearchParams();
		urlParams.set("token", token.token);
		if (params) {
			for (const [key, value] of Object.entries(params)) {
				if (value === undefined) {
					continue;
				}
				urlParams.set(key, value);
			}
		}

		const url = `${baseURL}${endpoint}?${urlParams.toString()}`;
		const requestStartAt = Date.now();

		const headers = {
			"Content-Type": "application/json",
			"Accept": "application/json",
		};

		let response: RequestResponse;
		try {
			response = await Network.HTTPJsonRequest(url, { method, headers, timeout: 5000 }, null);
		} catch (e: any) {
			// If the token cache includes a token, but the server has been shut down, it will fail here instead
			if (e?.message?.includes("ECONNREFUSED")) {
				CWLogger.CAction(5, FUNC_NAMES.SERV_MGR, {
					userId: userID,
					action: "tshock-conn-refused",
					status: 'call-refused',
					resource: null,
					details: {
						phase: 'api-call',
						fullMessage: e.message,
						target: {
							apiIP: this.ip,
							apiPort: process.env.TSHOCK_API_PORT,
							endpoint,
							method
						},
					}
				});

				return ResponseUtil.Success({ server: { status: false } });
			} else {
				CWLogger.Error(FUNC_NAMES.SERV_MGR, {
					userId: userID,
					action: "tshock-call-failed",
					error: e.message ?? "unknown",
					details: {
						target: {
							apiIP: this.ip,
							apiPort: process.env.TSHOCK_API_PORT,
							endpoint,
							method
						},
					}
				});
				throw e;
			}
		}

		CWLogger.CAction(5, FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "tshock-response",
			status: response.statusCode < 200 || response.statusCode >= 300 ? 'non-2xx' : 'ok',
			resource: null,
			details: {
				target: {
					apiIP: this.ip,
					apiPort: process.env.TSHOCK_API_PORT,
					endpoint,
					method,
				},
				requestDurationMs: Date.now() - requestStartAt,
				statusCode: response.statusCode,
				responseKeys: response.json ? Object.keys(response.json).slice(0, 20) : [],
				responseMessage: Parsers.Truncate(response.json?.message || response.json?.error || null),
			}
		});

		if (response.statusCode < 200 || response.statusCode >= 300) {
			const message = response.json?.message || "TShock API error";
			throw new Error(`TShock HTTP ${response.statusCode}: ${message}`);
		}

		return response.json;
	}

	public static DropTokenCache(): void
	{
		this.tokenCache.clear();
	}

	private async getAuthToken(): Promise<TokenData>
	{
		const cachedToken = TShockAPI.tokenCache.get(this.ip);
		if (cachedToken && cachedToken.expiresAtMs && cachedToken.expiresAtMs > Date.now()) {
			return {
				token: cachedToken.token,
				expiresAtMs: cachedToken.expiresAtMs,
				source: "cache",
				cacheHit: true
			};
		}

		const SM = new SecretsManagerDao();

		const secretName = process.env.TSHOCK_SECRET_NAME;
		Assert.IsTruthyString(secretName, "TSHOCK_SECRET_NAME is not set");
		const rawSecret = await SM.GetSecret(secretName!);
		Assert.IsTruthy(rawSecret, "Failed to get TShock secret");
		let secret: { TSHOCK_USER?: string, TSHOCK_PASSWORD?: string } = {};
		try {
			secret = JSON.parse(rawSecret!);
		} catch { }
		
		Assert.ObjectHasTruthyKeys(secret, ["TSHOCK_USER", "TSHOCK_PASSWORD"], "Secret is missing data");

		const newToken = await this.createNewToken(secret.TSHOCK_USER!, secret.TSHOCK_PASSWORD!);
		TShockAPI.tokenCache.set(this.ip, newToken);

		return {
			...newToken,
			source: "new-token",
			cacheHit: false
		};
	}

	private async createNewToken(username: string, password: string): Promise<TempToken>
	{
		Assert.IsTruthy(process.env.TSHOCK_API_PORT, "TShock API port is not set");
		const base = `http://${this.ip}:${process.env.TSHOCK_API_PORT}`;
		const endpoint = '/v2/token/create';

		const params = `?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
		const { statusCode, json } = await Network.HTTPJsonRequest(`${base}${endpoint}${params}`, { method: HttpMethod.GET, headers: { 'Accept': 'application/json' } });

		if (statusCode >= 200 && statusCode < 300) {
			const tokenExpiry = Date.now() + 5 * 60 * 1000; // Expire in 5 minutes
			return { token: json.token, expiresAtMs: tokenExpiry };
		}

		CWLogger.Error(FUNC_NAMES.SERV_MGR, {
			action: "tshock-create-token",
			error: `HTTP ${statusCode} - ${json.error || json.message || "[ unknown ]"}`,
			details: { json }
		});

		throw new Error("Failed to create TShock token");
	}
}