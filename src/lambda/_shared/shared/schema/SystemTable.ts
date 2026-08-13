export type SystemWorldCreateEntry = {
	uid?: string,
	instanceID?: string,
	requestedBy?: string,
	status?: string,
	step?: string,
	progress?: number,
	/** Latest raw worldgen status line tailed from the TShock stdout log (e.g. "Growing trees"). Liveness/progress hint only. */
	detail?: string,
	createdAt?: string,
	/** Heartbeat. Touched on every poll of the world file, so a stale value means the worker died — see WorldgenJob. */
	updatedAt?: string,
	jobID?: string,
	/** Set once, by the first worker invocation to claim this job. Its presence is what makes a lambda async retry a no-op instead of a second worldgen run. */
	workerStartedAt?: string,
	/** Why the job ended up in `failed`, in terms meant for the user rather than a stack trace. */
	failureReason?: string
};

/**
 * The single in-flight instance-shutdown job (`shutdown#<instanceID>`). Deliberately shaped like
 * {@link SystemWorldCreateEntry}: same worker/heartbeat/claim mechanics, same read model
 * (see ShutdownJob), so the frontend and backend idioms carry over unchanged.
 *
 * Unlike the worldgen row this one is never deleted — it is overwritten by the next shutdown. A
 * terminal row is harmless (liveness is judged by status + heartbeat, not by the row existing) and
 * keeping it preserves `failureReason`/`taskOutcomes` for diagnosis.
 */
export type SystemShutdownEntry = {
	uid?: string,
	instanceID?: string,
	/** Display name of the requester, or "[auto-shutoff]" when the countdown triggered it. */
	requestedBy?: string,
	status?: string,
	step?: string,
	progress?: number,
	/** Human-readable label for the current step, shown verbatim in the instance status tile. */
	detail?: string,
	createdAt?: string,
	/** Heartbeat. Touched between every task, so a stale value means the worker died — see ShutdownJob. */
	updatedAt?: string,
	jobID?: string,
	/** Set once, by the first worker invocation to claim this job. Its presence is what makes a lambda async retry a no-op instead of a second run of the task list. */
	workerStartedAt?: string,
	/** Why the job ended up in `failed`, in terms meant for the user rather than a stack trace. */
	failureReason?: string,
	/**
	 * Per-task result, keyed by task id ("ok" | "failed: <reason>"). Tasks are best-effort and never
	 * block the stop, so without this a task that silently did nothing is indistinguishable from one
	 * that worked — which is exactly the gap that existed before the shutdown became a tracked job.
	 */
	taskOutcomes?: Record<string, string>
};

export type RoleEntry = {
	uid?: string,
	roleId?: string,
	name?: string,
	permissions?: string[],
	resourceAccess?: string[],
	color?: string,
	createdAt?: string,
	updatedAt?: string,
};

export type PatreonTierMapEntry = {
	uid?: string,
	tierId?: string,
	tierName?: string,
	roleId?: string,
	createdAt?: string,
	updatedAt?: string,
};

/**
 * One live WebSocket connection (`conn#<connectionId>`). Per-environment on purpose: the system
 * table is per-env and a connection belongs to exactly one API Gateway stage, unlike the instance
 * table which is shared prod/stage.
 *
 * Read back through the sparse `recordType-index` GSI rather than a prefix scan, so fan-out cost
 * scales with the number of connections instead of the size of the whole table.
 */
export type RealtimeConnectionEntry = {
	uid?: string,
	/**
	 * Always `"conn"`. This is the GSI partition key — a row that omits it is invisible to fan-out
	 * with no error anywhere, so it is written unconditionally on every put.
	 */
	recordType?: string,
	connectionId?: string,
	/** Cognito sub, from the verified connect ticket. Diagnostics today; the hook for per-connection permission filtering later. */
	userSub?: string,
	/**
	 * `https://<domainName>/<stage>` for the callback API, taken straight off the `$connect` event
	 * rather than an env var — it is then automatically correct for both stages and for a custom
	 * domain, and it is one less piece of hand-set out-of-band configuration.
	 */
	apiEndpoint?: string,
	connectedAt?: number,
	/** Touched by `$default` pings. Deliberately NOT projected into the GSI, so a ping doesn't rewrite the index. */
	lastSeenAt?: number,
	/**
	 * Dynamo TTL, epoch **seconds**. A backstop only: `$disconnect` and the `GoneException` delete on
	 * publish are the real cleanup paths. API Gateway hard-kills a connection at 2h, so a row still
	 * present at 3h is definitionally garbage.
	 */
	expireAt?: number,
};

/**
 * One entry in an instance's item rule list. `netId` is the Terraria item id and the only thing
 * matched on; `name` is carried purely so the editor can render a readable list without needing the
 * item-name map, and is refreshed opportunistically from whatever a snapshot last called that id.
 */
export type ItemRuleEntry = {
	netId: number,
	name?: string,
	note?: string,
};

/**
 * The per-instance item rule list (`itemrules#<instanceID>`).
 *
 * Per-environment, like `autoshutoff#`, even though the instance registry itself is shared — stage
 * gets to trial a rule set without it applying to prod's players.
 */
export type ItemRulesEntry = {
	uid?: string,
	instanceID?: string,
	/** `"whitelist"` flags anything *not* listed; `"blacklist"` flags anything listed. */
	mode?: "whitelist" | "blacklist",
	/**
	 * Master switch. Read by `logs-manager` on every join/leave before it wakes the scanner, so
	 * turning this off costs one GetItem per roster event and nothing else — no invoke, no TShock
	 * round trip.
	 */
	enabled?: boolean,
	/**
	 * Container groups to scan, a subset of `core|storage|misc|loadouts`. Passed straight through as
	 * the plugin's `include` param, so narrowing this to worn/carried gear makes the drain cheaper
	 * rather than just filtering afterwards.
	 */
	groups?: string[],
	entries?: ItemRuleEntry[],
	updatedBy?: string,
	createdAt?: string,
	updatedAt?: string,
};

/** One flagged item, carrying enough position for the UI to ring the exact square it came from. */
export type ViolationItem = {
	netId: number,
	name: string,
	stack: number,
	prefix: number,
	container: string,
	slot: number,
	globalSlot: number,
};

/**
 * The most recent rule violation for one player. Replaced wholesale by their next join, and deleted
 * outright when that join comes back clean — "latest per player" only means something if a player
 * who fixed their inventory stops being flagged.
 */
export type PlayerViolation = {
	player: string,
	account?: string,
	/**
	 * Which capture tripped it. Always `"join"` today — leave snapshots are drained but deliberately
	 * not evaluated — and recorded anyway so a later leave-side check needn't migrate existing rows.
	 */
	kind: string,
	/** Snapshot `CapturedAtUtc`, epoch ms. */
	at: number,
	snapshotId: number,
	/** The mode in force when this was evaluated, so a stale flag can be read in its own terms. */
	mode: string,
	/** Capped; see `truncated`. Whitelist mode against an unlisted item can otherwise hit 350 entries. */
	items: ViolationItem[],
	/** Total offending items *before* the cap. */
	itemCount: number,
	truncated?: boolean,
};

/**
 * Snapshot drain state for one instance (`invscan#<instanceID>`): where the cursor is, who is
 * currently draining, and the latest violation per player.
 *
 * The cursor is the only record of what we have consumed — the plugin's snapshot store is
 * non-destructive, has no ack, and lives in memory, so nothing on that side remembers us.
 */
export type InventoryScanEntry = {
	uid?: string,
	instanceID?: string,
	/**
	 * Exclusive id floor, sent back as the plugin's `since`. The plugin re-zeroes its ids on server
	 * restart, so a `head` below this means a restart happened and the cursor must reset to 0 rather
	 * than sit above every id the plugin will ever issue again.
	 */
	cursor?: number,
	/** Highest id the plugin reported issuing, as of the last drain. Diagnostics. */
	head?: number,
	lastScanAt?: number,
	lastScanStatus?: string,
	/** Epoch ms until which a worker owns the drain. See `claimScanLease`. */
	leaseUntil?: number,
	leaseOwner?: string,
	/**
	 * Set by a worker that couldn't take the lease. The holder re-checks it before releasing and
	 * drains again, which is how a join burst's later events still get scanned by the one drain.
	 */
	pending?: boolean,
	/** Latest violation per player name. Pruned to the most recent entries; see `PLAYER_VIOLATION_CAP`. */
	violations?: Record<string, PlayerViolation>,
	updatedAt?: string,
};

export type AutoShutoffStateEntry = {
	uid?: string,
	serverId?: string,
	lastPlayerLogAt?: number | null,
	lastPlayersActive?: number | null,
	lastPlayerEventType?: string | null,
	sequenceStage?: string | null,
	sequenceUpdatedAt?: number | null,
	scheduledShutdownAt?: number | null,
	pauseUntilAt?: number | null,
	canceled?: boolean | null,
	shutdownRequestedAt?: number | null,
	ec2StopRequestedAt?: number | null,
	lastUpdatedAt?: number | null,
	serverStartedAt?: number | null,
	instanceStartedAt?: number | null,
};
