import { RECORD_TYPE_INDEX } from "../../vars.js";

/**
 * The WebSocket notification contract.
 *
 * This is a **notification pipeline, not a data channel**. An event says "something about this
 * instance changed"; the frontend responds by calling the REST endpoint it already had. That is what
 * keeps one source of truth for every payload, one server-side permission check per read, and the
 * existing pollers usable as a fallback — block the socket entirely and the app behaves as it did
 * before it existed.
 *
 * The invariant to defend: **no field of {@link RealtimeEvent} is ever rendered.** The first event
 * that carries display data forks the permission model, because the socket has no
 * `ValidateResourceAccess` behind it the way every REST read does.
 *
 * Lives here rather than in `src/shared/types/` because it carries runtime values. Everything in
 * `src/shared/types/` is imported with `import type` and erased at compile time; `_shared/shared` is
 * copied into each function's bundle by `build.js`, so a *value* import reaching outside this tree
 * resolves at source level, typechecks, and then fails at runtime with `ERR_MODULE_NOT_FOUND` on
 * first call. `permissionValues.ts` sits in this tree for the same reason.
 *
 * Mirrored for the frontend in `src/tte-server-manager/src/util/realtimeEvents.js` — the same
 * hand-mirroring arrangement as the permission strings. The mirror only needs the constants.
 */

/** Bumped only for a breaking envelope change. Clients ignore versions they don't know. */
export const REALTIME_SCHEMA_VERSION = 1;

export const REALTIME_EVENTS = {
	/** EC2 power state moved, or a transition was requested. */
	INSTANCE_STATE: "instance.state",
	/** The `shutdown#<id>` job row changed phase. */
	INSTANCE_SHUTDOWN: "instance.shutdown",
	/** The TShock server came up or went down. */
	SERVER_STATE: "server.state",
	/** The player roster changed. Join/leave only — see the publish site in `pushLog`. */
	SERVER_PLAYERS: "server.players",
	/** Auto-shutoff countdown state changed in a user-visible way. */
	SERVER_AUTOSHUTOFF: "server.autoshutoff",
	/**
	 * The set of players flagged by the item rules changed. Published only on a real change — every
	 * join runs a scan, so an unconditional publish would be a refetch per join per browser.
	 */
	SERVER_VIOLATIONS: "server.violations",
	/** A worldgen job was queued or changed phase. */
	WORLD_CREATE: "world.create",
} as const;

export type RealtimeEventType = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

export type RealtimeEvent = {
	v: number;
	type: RealtimeEventType;
	/** The instance this concerns. The only identifier an event ever carries. */
	instanceId: string;
	/** Publisher clock, epoch ms. Diagnostics and ordering only — never rendered. */
	at: number;
	/**
	 * Advisory and non-authoritative: a state name, a player event type, a job step. May be used to
	 * decide *which* refetch to run, and is useful in CloudWatch. Must never be stored in a Pinia
	 * store or rendered — a user-visible "PlayerX joined" needs a payload-carrying feed with its own
	 * permission, which is a separate decision from this pipeline.
	 */
	hint?: string;
};

/**
 * Payload of the self-invoke that drives fan-out. Discriminated on `requestType` by
 * `realtime-manager`'s dispatcher, the same way `instance-manager` discriminates `shutdown-request`.
 */
export type RealtimePublishRequest = {
	requestType: "realtime-publish";
	event: RealtimeEvent;
};

export const REALTIME_PUBLISH_REQUEST_TYPE = "realtime-publish";

/** `uid` prefix for connection rows in the system table. */
export const REALTIME_CONN_PREFIX = "conn#";

/**
 * Value written to a connection row's `recordType`, and the partition key used to read them back
 * out of {@link REALTIME_CONN_INDEX}.
 */
export const REALTIME_CONN_RECORD_TYPE = "conn";

/**
 * @deprecated Prefer {@link RECORD_TYPE_INDEX} in `vars.ts`. The index is no longer connection-only —
 * the item preset library reads through it too — and this alias exists so the realtime call sites
 * keep working rather than because the name is still accurate.
 */
export const REALTIME_CONN_INDEX = RECORD_TYPE_INDEX;

export const realtimeConnectionKey = (connectionId: string): string => `${REALTIME_CONN_PREFIX}${connectionId}`;
