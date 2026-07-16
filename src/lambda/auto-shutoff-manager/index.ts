import type { Context } from "aws-lambda";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";
import type { AutoShutoffMessage } from "./actions/types.js";
import { handleTick } from "./actions/handleTick.js";
import { handleCheck } from "./actions/handleCheck.js";
import { handleEc2Stop } from "./actions/handleEc2Stop.js";

/**
 * Invoked directly by EventBridge Scheduler: the recurring per-environment tick, plus the one-time
 * schedules each countdown step creates for the next one (see `scheduleFollowUp`). The event is the
 * schedule's Input verbatim — one message per invocation, already parsed — rather than a batch
 * wrapper.
 */
export const handler = async (event: AutoShutoffMessage | null, context: Context) => {
	const message: AutoShutoffMessage = event ?? { type: "tick" };

	CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
		userId: "[auto-shutoff]",
		action: "invoke",
		details: { message },
	});

	let result: unknown;
	switch (message.type || "tick") {
		case "tick":
			result = await handleTick(message, context);
			break;
		case "check":
			result = await handleCheck(message, context);
			break;
		case "ec2-stop":
			result = await handleEc2Stop(message, context);
			break;
		default:
			await CWLogger.Error(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
				userId: "[auto-shutoff]",
				action: "skip",
				error: "unknown message type " + message.type,
				details: { message },
			});
			result = { action: "skip", reason: "unknown-message-type" };
	}

	CWLogger.CAction(2, FUNC_NAMES.AUTO_SHUTOFF_MGR, {
		userId: "[auto-shutoff]",
		action: "invoke-complete",
		details: { result },
	});

	await CWLogger.FlushAll();
	return { ok: true, result };
};
