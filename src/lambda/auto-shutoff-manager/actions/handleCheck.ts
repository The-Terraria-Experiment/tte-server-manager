import type { AutoShutoffMessage, CheckResult, CheckStage } from "./types.js";
import { runCheck } from "./runCheck.js";

export async function handleCheck(message: AutoShutoffMessage): Promise<CheckResult> {
	const serverId = message.serverId;
	if (!serverId) {
		return { action: "skip", reason: "missing-server-id" };
	}

	const stage = (message.stage || "initial") as CheckStage;
	return runCheck(serverId, stage);
}
