export type CheckStage = "initial" | "second" | "final" | "shutdown";

export type AutoShutoffMessage = {
	type?: "tick" | "check" | "ec2-stop";
	stage?: CheckStage;
	serverId?: string;
};

export type CheckResult = {
	serverId?: string;
	stage?: CheckStage;
	action: string;
	reason?: string;
	idleMinutes?: number | null;
};
