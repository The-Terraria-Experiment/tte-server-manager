/**
 * Frontend mirror of the WebSocket event contract.
 *
 * Must stay in sync with `src/lambda/_shared/shared/utils/realtime/RealtimeEvents.ts` — the same
 * hand-mirroring arrangement as `permissionValues.js`, and for the same reason: the lambda tree and
 * this Vite app are separate roots with no shared module resolution.
 *
 * Drift is contained rather than fatal. `realtimeStore` ignores an unknown event type silently, so a
 * backend that ships a new type before this file mirrors it degrades to "the existing poller still
 * handles it" — which is the fallback guarantee working as designed, not a bug.
 *
 * Remember: these events are notifications, never data. An event means "call the REST endpoint you
 * already have for this instance". Nothing on the wire is ever rendered.
 */

export const REALTIME_SCHEMA_VERSION = 1;

export const REALTIME_EVENTS = {
	INSTANCE_STATE: "instance.state",
	INSTANCE_SHUTDOWN: "instance.shutdown",
	SERVER_STATE: "server.state",
	SERVER_PLAYERS: "server.players",
	SERVER_AUTOSHUTOFF: "server.autoshutoff",
	WORLD_CREATE: "world.create",
};

/** Every value of REALTIME_EVENTS, for the "do we know this type?" check. */
export const KNOWN_REALTIME_EVENTS = new Set(Object.values(REALTIME_EVENTS));
