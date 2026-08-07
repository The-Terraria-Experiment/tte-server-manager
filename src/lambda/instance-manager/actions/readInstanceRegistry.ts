import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { InstanceRegistry } from "../shared/utils/InstanceRegistry.js";
import { ENVIRONMENTS } from "../shared/vars.js";

const EC2 = new Ec2Dao();

/**
 * Every `inst#<id>` row, across all environments, joined with live EC2 state.
 *
 * Deliberately unfiltered by environment, unlike `GET /instances` — this feeds the registry editor,
 * which has to be able to see and fix an instance registered to the *other* environment. Entries EC2
 * can't resolve come back with `state: "missing"` rather than failing the request, so a terminated
 * box can still be removed through the UI.
 */
export const readInstanceRegistry = async (event: AuthorizedEvent, context: Context) => {
	void context;

	// Uncached: the editor refetches immediately after every save, and a stale read there would
	// show the admin a list missing the change they just made.
	const entries = await InstanceRegistry.GetAllEntries({ skipCache: true });
	const ec2Statuses = await EC2.GetMultipleInstanceStatus(entries.map((entry) => entry.id));
	const statusById = new Map(ec2Statuses.map((status) => [status.id, status]));

	const instances = entries.map((entry) => {
		const status = statusById.get(entry.id);
		const missing = !status || status.state === InstanceState.MISSING;
		return {
			id: entry.id,
			envs: entry.envs,
			// The live EC2 tag wins over the name captured at registration, which is only a fallback
			// for when the instance can no longer be described.
			name: missing ? (entry.name ?? "(Unknown)") : status.name,
			state: status?.state ?? InstanceState.MISSING,
			missing,
			registeredAt: entry.registeredAt ?? null,
			registeredBy: entry.registeredBy ?? null,
		};
	});

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-instance-registry",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { count: instances.length },
	});

	return ResponseUtil.Success({ instances, environments: ENVIRONMENTS });
};
