import type { Context, SQSEvent } from "aws-lambda";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";
import type { AutoShutoffMessage } from "./actions/types.js";
import { handleTick } from "./actions/handleTick.js";
import { handleCheck } from "./actions/handleCheck.js";
import { handleEc2Stop } from "./actions/handleEc2Stop.js";

export const handler = async (event: SQSEvent, context: Context) => {
	void context;
	const results: unknown[] = [];

	for (const record of event.Records || []) {
		const message = parseMessage(record.body);
		switch (message.type || "tick") {
			case "tick":
				results.push(await handleTick(message));
				break;
			case "check":
				results.push(await handleCheck(message));
				break;
			case "ec2-stop":
				results.push(await handleEc2Stop(message));
				break;
			default:
				await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
					userId: "[auto-shutoff]",
					action: "skip",
					status: "unknown-message-type",
					details: { rawBody: record.body },
				});
				results.push({ action: "skip", reason: "unknown-message-type" });
		}
	}

	await CWLogger.FlushAll();
	return { ok: true, results };
};

function parseMessage(body: string): AutoShutoffMessage {
	if (!body) {
		return { type: "tick" };
	}

	try {
		const parsed = JSON.parse(body) as AutoShutoffMessage;
		return parsed;
	} catch {
		return { type: "tick" };
	}
}
