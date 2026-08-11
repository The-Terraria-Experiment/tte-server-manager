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
