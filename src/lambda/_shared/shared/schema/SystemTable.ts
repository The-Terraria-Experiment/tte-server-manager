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
