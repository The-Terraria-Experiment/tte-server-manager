import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { InstanceRegistry } from "../shared/utils/instance/InstanceRegistry.js";
import { flavorFor, toClientFlavor } from "../shared/utils/instance/ServerFlavor.js";

const EC2 = new Ec2Dao();

export const list = async (event: AuthorizedEvent, context: Context) => {
	void context;

	// Scoped to this lambda's environment: the registry records which environments each instance
	// belongs to, so prod and stage no longer see one flat shared list.
	const entries = await InstanceRegistry.GetRegisteredInstances();
	const instancesData = await EC2.GetMultipleInstanceStatus(entries.map((entry) => entry.id));
	const serverTypes = new Map(entries.map((entry) => [entry.id, entry.serverType]));

	const instances = instancesData.map((instanceData) => ({
		id: instanceData.id,
		state: instanceData.state,
		name: instanceData.name,
		// Which game server the box runs and what it supports — see `toClientFlavor` for why this is
		// on the list rather than the status responses.
		...toClientFlavor(flavorFor(serverTypes.get(instanceData.id))),
	}));

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "list",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instances },
	});

	return ResponseUtil.Success({ instances });
};
