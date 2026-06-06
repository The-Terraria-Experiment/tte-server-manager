import type { AutoShutoffMessage, CheckResult } from "./types.js";
import { getConfiguredServerIds } from "./state.js";
import { runCheck } from "./runCheck.js";

export async function handleTick(message: AutoShutoffMessage): Promise<CheckResult[]> {
	const serverIds = message.serverId ? [message.serverId] : getConfiguredServerIds();
	if (serverIds.length === 0) {
		return [{ action: "skip", reason: "no-servers" }];
	}

	const results: CheckResult[] = [];
	for (const serverId of serverIds) {
		results.push(await runCheck(serverId, "initial"));
	}
	return results;
}
