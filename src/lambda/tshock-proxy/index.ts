import type { Context } from "aws-lambda";
import { TShockDirect } from "./shared/utils/tshock/TShockDirect.js";
import { TSHOCK_PROXY_REQUEST_TYPE, type TShockProxyRequest, type TShockProxyResponse } from "./shared/utils/tshock/TShockProxy.js";

/**
 * Performs TShock REST calls on behalf of the other lambdas.
 *
 * This function exists for exactly one reason: it is attached to the fleet's VPC, so the instances'
 * REST port can be closed to the internet and opened only to this function's security group. Before
 * it, every REST call went to an instance's public IP over plain HTTP — which put the REST account
 * password in a query string on the open internet and forced port 3891 to accept traffic from
 * anywhere.
 *
 * Three constraints follow from that placement, and all three are load-bearing:
 *
 * 1. **It makes no AWS API calls.** No Secrets Manager, no DynamoDB, no CloudWatch SDK. That is why
 *    it needs no NAT gateway and no interface VPC endpoints, which is what makes the whole approach
 *    affordable. The credential and the port arrive in the payload for this reason. Adding an AWS
 *    call here means adding an endpoint (or a NAT) to pay for it.
 * 2. **It logs with `console.log`, never `CWLogger`.** `CWLogger` writes via the CloudWatch Logs SDK
 *    to custom log groups; from inside the VPC that call has nowhere to go and would hang until the
 *    invocation timed out. `console.log` is collected by the Lambda service and never touches the ENI.
 * 3. **It never logs its event.** The payload carries a live TShock credential.
 *
 * It also deliberately skips `createHandler`: that composes `corsHandler`, which forces an
 * API-Gateway-shaped result, and this function is only ever invoked directly by other lambdas.
 */
export const handler = async (event: TShockProxyRequest, context: Context): Promise<TShockProxyResponse> => {
	void context;

	if (!event || event.requestType !== TSHOCK_PROXY_REQUEST_TYPE) {
		console.log(JSON.stringify({ action: "invoke-rejected", reason: "unknown-request-type" }));
		return { ok: false, reason: "error", message: "Unrecognised request type for tshock-proxy" };
	}

	for (const field of ["address", "port", "endpoint", "method"] as const) {
		if (!event[field]) {
			return { ok: false, reason: "error", message: `tshock-proxy request is missing '${field}'` };
		}
	}
	if (!event.credential?.username || !event.credential?.password) {
		return { ok: false, reason: "error", message: "tshock-proxy request is missing credentials" };
	}

	try {
		const client = new TShockDirect(event.address, event.port);
		return await client.Request(event);
	} catch (e: any) {
		// TShockDirect resolves its own failures, so reaching here means something outside the request
		// path broke. Caught rather than thrown so the caller gets a typed response instead of a
		// FunctionError envelope it would have to unpack.
		console.log(JSON.stringify({
			action: "invoke-failed",
			address: event.address,
			endpoint: event.endpoint,
			error: e?.message ?? "unknown",
		}));
		return { ok: false, reason: "error", message: e?.message ?? "tshock-proxy failed" };
	}
};
