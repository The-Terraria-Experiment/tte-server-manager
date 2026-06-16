export type SystemWorldCreateEntry = {
	uid?: string,
	instanceID?: string,
	requestedBy?: string,
	status?: string,
	step?: string,
	progress?: number,
	createdAt?: string,
	updatedAt?: string,
	jobID?: string
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
