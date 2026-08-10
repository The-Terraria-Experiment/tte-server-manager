import { CWLogger } from "../../aws/CloudWatch.js";
import { LambdaDao } from "../../aws/Lambda.js";
import { SecretsManagerDao } from "../../aws/SecretsManager.js";
import { FUNC_NAMES } from "../../constants.js";
import { TSHOCK_PROXY_FUNCTION_ARN } from "../../vars.js";
import { Assert } from "../core/Assert.js";
import { ResponseUtil } from "../core/APIResponse.js";
import { HttpMethod } from "../core/Network.js";
import { Parsers } from "../core/Parsers.js";
import { TSHOCK_PROXY_REQUEST_TYPE, type TShockCredential, type TShockProxyRequest, type TShockProxyResponse } from "./TShockProxy.js";


/**
 * Caller-side client for TShock's REST API.
 *
 * This does not speak HTTP. TShock's REST port is closed to everything except the `tshock-proxy`
 * lambda's security group, so the call is handed to that function over a synchronous invoke and it
 * makes the request from inside the VPC. Previously this class dialled the instance's *public* IP
 * over plain HTTP across the internet, which meant the REST account password (query-string only, on
 * `/v2/token/create`) and every subsequent token crossed the open internet, and port 3891 had to be
 * reachable from anywhere.
 *
 * The split is: everything needing AWS APIs — the Secrets Manager read, CloudWatch logging — stays
 * here, outside the VPC. The proxy gets the credential in its payload and therefore needs no IAM,
 * no NAT gateway and no interface endpoints. See `TShockDirect` for the other half.
 */
export class TShockAPI {
	/**
	 * Cached across invocations of the same container, like the token cache this class used to hold.
	 * The secret is one value for the whole fleet, so this is keyed by nothing.
	 */
	private static credential: TShockCredential | null = null;

	private readonly ip!: string

	constructor(serverAddress: string) {
		this.ip = serverAddress;
	}

	public async APIRequest(userID: string, endpoint: string, params: Record<string, any> | undefined = undefined, method: HttpMethod = HttpMethod.GET): Promise<Record<string, any>>
	{
		Assert.IsTruthyString(endpoint, "Missing endpoint for TShock API call");
		Assert.IsTruthy(process.env.TSHOCK_API_PORT, "TShock API port is not set");

		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "tshock-call-api",
			status: "pre-call",
			resource: null,
			details: { apiIP: this.ip, endpoint, method }
		});

		// Concatenated from env in vars.ts, so an unset variable arrives as the literal
		// "undefined:stage" rather than a falsy value — check the raw var, not the derived constant.
		if (!process.env.TSHOCK_PROXY_FUNCTION_ARN) {
			throw new Error("No tshock-proxy function ARN configured");
		}

		const credential = await this.getCredential(userID, endpoint, method);

		const request: TShockProxyRequest = {
			requestType: TSHOCK_PROXY_REQUEST_TYPE,
			address: this.ip,
			port: process.env.TSHOCK_API_PORT!,
			endpoint,
			method,
			credential,
			userID,
		};
		if (params) {
			request.params = params;
		}

		const requestStartAt = Date.now();

		let result: TShockProxyResponse;
		try {
			const Lambda = new LambdaDao();
			result = await Lambda.InvokeFunctionSync<TShockProxyResponse>(request, TSHOCK_PROXY_FUNCTION_ARN);
		} catch (e: any) {
			CWLogger.Error(FUNC_NAMES.SERV_MGR, {
				userId: userID,
				action: "tshock-proxy-invoke-failed",
				error: e.message ?? "unknown",
				details: {
					target: { apiIP: this.ip, apiPort: process.env.TSHOCK_API_PORT, endpoint, method },
				}
			});
			throw e;
		}

		CWLogger.CAction(5, FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "tshock-response",
			status: result.ok ? "ok" : result.reason,
			resource: null,
			details: {
				target: { apiIP: this.ip, apiPort: process.env.TSHOCK_API_PORT, endpoint, method },
				requestDurationMs: Date.now() - requestStartAt,
				statusCode: result.ok ? result.statusCode : null,
				responseKeys: result.ok ? Object.keys(result.json).slice(0, 20) : [],
				responseMessage: result.ok ? Parsers.Truncate(result.json?.message || result.json?.error || "") : "",
			}
		});

		if (!result.ok) {
			if (result.reason === "connection-refused") {
				CWLogger.CAction(5, FUNC_NAMES.SERV_MGR, {
					userId: userID,
					action: "tshock-conn-refused",
					status: "call-refused",
					resource: null,
					details: {
						target: { apiIP: this.ip, apiPort: process.env.TSHOCK_API_PORT, endpoint, method },
					}
				});

				// Returns an APIGatewayProxyResult from a method typed as returning TShock JSON. That
				// is odd, but it is the long-standing contract every "is the server up?" caller reads,
				// so it is preserved exactly rather than tidied here.
				return ResponseUtil.Success({ server: { status: false } });
			}

			CWLogger.Error(FUNC_NAMES.SERV_MGR, {
				userId: userID,
				action: "tshock-call-failed",
				error: result.message,
				details: {
					target: { apiIP: this.ip, apiPort: process.env.TSHOCK_API_PORT, endpoint, method },
				}
			});
			throw new Error(result.message);
		}

		return result.json;
	}

	/**
	 * Forces the next call to re-read the REST credential from Secrets Manager. Useful after rotating
	 * the secret, which is the only thing that invalidates it.
	 *
	 * Deliberately **not** called after a world launch or server restart. It used to be, back when it
	 * was `DropTokenCache` and this class cached TShock *tokens* — those a restart really does
	 * invalidate. Tokens now live in `tshock-proxy` containers that this process cannot reach, and
	 * the 403-triggered re-mint in `TShockDirect.Request` recovers from a restart on its own. Calling
	 * this on a restart would only buy a pointless Secrets Manager read on the next TShock call,
	 * which is the hot path.
	 */
	public static DropCredentialCache(): void
	{
		TShockAPI.credential = null;
	}

	private async getCredential(userID: string, endpoint: string, method: HttpMethod): Promise<TShockCredential>
	{
		if (TShockAPI.credential) {
			return TShockAPI.credential;
		}

		try {
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

			TShockAPI.credential = {
				username: secret.TSHOCK_USER!,
				password: secret.TSHOCK_PASSWORD!,
			};

			return TShockAPI.credential;
		} catch (e: any) {
			CWLogger.Error(FUNC_NAMES.SERV_MGR, {
				userId: userID,
				action: "tshock-get-credential",
				error: e.message ?? "unknown",
				details: {
					target: { apiIP: this.ip, apiPort: process.env.TSHOCK_API_PORT, endpoint, method },
				}
			});
			throw e;
		}
	}
}
