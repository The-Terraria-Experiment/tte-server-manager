import { LambdaDao } from "../../aws/Lambda.js";
import { CWLogger } from "../../aws/CloudWatch.js";
import { FUNC_NAMES } from "../../constants.js";
import { REALTIME_MANAGER_FUNCTION_ARN } from "../../vars.js";
import {
	REALTIME_EVENTS,
	REALTIME_PUBLISH_REQUEST_TYPE,
	REALTIME_SCHEMA_VERSION,
	type RealtimeEvent,
	type RealtimeEventType,
	type RealtimePublishRequest,
} from "./RealtimeEvents.js";

/**
 * The publish side of the WebSocket notification pipeline.
 *
 * Business code calls one of the `Publish*` helpers after it has written state. Fan-out itself happens
 * in `realtime-manager`, reached by an async self-invoke — which is what keeps
 * `execute-api:ManageConnections`, the connection store and the API Gateway Management SDK confined
 * to a single function and a single IAM role.
 *
 * Two rules govern every call site, and both are load-bearing:
 *
 * 1. **Publish strictly after the state write.** The client's reaction to an event is a REST refetch,
 *    so a publish that precedes its write is a race the client loses: it reads pre-write state,
 *    renders it, and no second event is coming. That yields a UI *more* stale with the socket than
 *    without it, and it is close to impossible to attribute after the fact.
 * 2. **`Publish` is awaited but cannot throw.** Awaited because Lambda freezes the execution
 *    environment the moment the handler's promise settles — a floating publish is frozen mid-request
 *    and may resume on an arbitrary later invocation of that container, or never (the same trap as a
 *    missing `CWLogger.FlushAll()`). Unable to throw because the socket is optional by contract: in
 *    `pushLog` a thrown publish error would become a 500 and make the TShock plugin retry a log it
 *    had already stored.
 *
 * The await costs one queued `InvokeFunction` (~10-20ms, `InvocationType: "Event"` returns as soon as
 * it is accepted). That is worth paying even on the plugin's synchronous path; do not "optimise" it
 * into a floating promise.
 */
export class Realtime {
	/**
	 * Notifies every connected client that something about `instanceId` changed.
	 *
	 * Never throws, and never returns anything a caller should branch on — a failed notification is
	 * not a failed operation.
	 */
	public static async Publish(partial: { type: RealtimeEventType; instanceId: string; hint?: string }): Promise<void> {
		// The RAW env var, not the derived constant: vars.ts concatenates the alias suffix, so an unset
		// var arrives here as the literal "undefined:stage". This check is therefore also the kill
		// switch — unset the var and publishing is a no-op for that environment, with no deploy.
		if (!process.env.REALTIME_MANAGER_FUNCTION_ARN) {
			return;
		}

		if (!partial.instanceId) {
			return;
		}

		const event: RealtimeEvent = {
			v: REALTIME_SCHEMA_VERSION,
			type: partial.type,
			instanceId: partial.instanceId,
			at: Date.now(),
			...(partial.hint ? { hint: partial.hint } : {}),
		};

		const payload: RealtimePublishRequest = {
			requestType: REALTIME_PUBLISH_REQUEST_TYPE,
			event,
		};

		try {
			await new LambdaDao().InvokeFunction(payload, REALTIME_MANAGER_FUNCTION_ARN);
		} catch (error) {
			await CWLogger.Error(FUNC_NAMES.REALTIME_MGR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "realtime-publish", event },
			});
		}
	}

	/** EC2 power state moved, or a transition was just requested. */
	public static async PublishInstanceState(instanceId: string, hint?: string): Promise<void> {
		return Realtime.Publish({ type: REALTIME_EVENTS.INSTANCE_STATE, instanceId, ...(hint ? { hint } : {}) });
	}

	/** A shutdown job changed phase. `hint` is the task id, which the UI maps to a step label. */
	public static async PublishInstanceShutdown(instanceId: string, hint?: string): Promise<void> {
		return Realtime.Publish({ type: REALTIME_EVENTS.INSTANCE_SHUTDOWN, instanceId, ...(hint ? { hint } : {}) });
	}

	/** The TShock server came up or went down. */
	public static async PublishServerState(instanceId: string, hint?: string): Promise<void> {
		return Realtime.Publish({ type: REALTIME_EVENTS.SERVER_STATE, instanceId, ...(hint ? { hint } : {}) });
	}

	/**
	 * The player roster changed. Only join and leave reach here — see `pushLog` for why chat, death
	 * and spawn deliberately do not.
	 */
	public static async PublishServerPlayers(instanceId: string, hint?: string): Promise<void> {
		return Realtime.Publish({ type: REALTIME_EVENTS.SERVER_PLAYERS, instanceId, ...(hint ? { hint } : {}) });
	}

	/** Auto-shutoff countdown state changed in a way a user would see. */
	public static async PublishAutoShutoff(instanceId: string, hint?: string): Promise<void> {
		return Realtime.Publish({ type: REALTIME_EVENTS.SERVER_AUTOSHUTOFF, instanceId, ...(hint ? { hint } : {}) });
	}

	/**
	 * The item-rule violation set changed.
	 *
	 * Only call this when the set actually moved. The scanner runs on every join, and its `hint` is a
	 * player count rather than a name — the client's response is a refetch of the violations endpoint,
	 * which is where the permission check lives.
	 */
	public static async PublishServerViolations(instanceId: string, hint?: string): Promise<void> {
		return Realtime.Publish({ type: REALTIME_EVENTS.SERVER_VIOLATIONS, instanceId, ...(hint ? { hint } : {}) });
	}

	/** A worldgen job was queued or changed phase. */
	public static async PublishWorldCreate(instanceId: string, hint?: string): Promise<void> {
		return Realtime.Publish({ type: REALTIME_EVENTS.WORLD_CREATE, instanceId, ...(hint ? { hint } : {}) });
	}
}
