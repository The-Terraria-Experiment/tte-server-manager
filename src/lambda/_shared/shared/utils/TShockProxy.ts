import type { HttpMethod } from "./Network.js";

/**
 * Wire contract between `TShockAPI` (caller side, outside the VPC) and the `tshock-proxy` lambda
 * (inside the VPC, the only thing that can reach TShock's REST port). Both sides import these types
 * so the shape can't drift on one side of a synchronous invoke.
 *
 * The credential travels in the payload rather than being read by the proxy itself: that keeps the
 * proxy free of any AWS API call, which is what lets it sit in a VPC with no internet route, no NAT
 * gateway and no interface endpoints. The cost of that choice is that this object is a live
 * credential in transit — **nothing may log a `TShockProxyRequest`**, and the proxy must not echo
 * its event.
 *
 * `port` rides the payload for the same reason, so the proxy needs no environment variables at all.
 */
export type TShockProxyRequest = {
	requestType: "tshock-call",
	/** Private IP of the target instance. Never the public one — see `InstanceStatus.privateIp`. */
	address: string,
	port: string,
	endpoint: string,
	method: HttpMethod,
	params?: Record<string, any>,
	credential: TShockCredential,
	/** Carried for log correlation only; the proxy does no permission work. */
	userID: string,
};

export type TShockCredential = {
	username: string,
	password: string,
};

/**
 * `connection-refused` is a distinct outcome rather than an error because the callers treat it as
 * "the game server isn't running", which is an ordinary state, not a failure. Collapsing it into
 * `error` would turn every stopped instance into a 500.
 */
export type TShockProxyResponse =
	| { ok: true, statusCode: number, json: Record<string, any> }
	| { ok: false, reason: "connection-refused" }
	| { ok: false, reason: "error", message: string };

export const TSHOCK_PROXY_REQUEST_TYPE = "tshock-call" as const;
