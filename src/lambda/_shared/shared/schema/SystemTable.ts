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
	stage?: string,
	lastCheckAt?: number,
	lastLogAt?: number | null,
	lastLogPlayers?: number | null,
	lastNonEmptyAt?: number | null,
	lastEmptyAt?: number | null,
	livePlayers?: number | null,
	serverStopAt?: number | null,
	instanceStopAt?: number | null,
	instanceState?: string,
};
