import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { TShockAPI } from "../shared/utils/TShockAPI.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { Assert } from "../shared/utils/Assert.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";

export const getBans = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const serverID = event.pathParameters?.id;

	if (!serverID) {
		return ResponseUtil.ValidationError("ServerID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverID}`);

	try {
		const EC2 = new Ec2Dao();
		const instance = await EC2.GetInstanceStatus(serverID);
		const instanceIP = instance.publicIp;

		if (!instanceIP || instanceIP === "PENDING") {
			return ResponseUtil.Error(`Instance ${serverID} has no reachable public IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		const userID = Parsers.GetUserSub(event);
		Assert.IsTruthyString(userID, "No user ID");

		const TShock = new TShockAPI(instanceIP);
		const result = await TShock.APIRequest(userID!, "/v3/bans/list");

		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "get-banlist",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { instanceIP, instanceID: serverID },
		});

		return ResponseUtil.Success({ result });
	} catch (e: any) {
		return ResponseUtil.Error(e.message || "Failed to fetch ban list");
	}
};
