import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Parsers } from "../shared/utils/Parsers.js";

const EC2 = new Ec2Dao();

export const list = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceIds = (process.env.EC2_INSTANCE_IDS || "").split(",").filter((id) => id);
	const instancesData = await EC2.GetMultipleInstanceStatus(instanceIds);

	const instances = instancesData.map((instanceData) => ({
		id: instanceData.id,
		state: instanceData.state,
		name: instanceData.name,
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
