import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { TShockAPI } from "../utils/TShockAPI.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { Assert } from "../shared/utils/Assert.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";

type DeleteBanBody = {
	ticketNumber?: number | string;
	fullDelete?: boolean;
};

export const deleteBan = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const serverID = event.pathParameters?.id;
	const { ticketNumber, fullDelete } = (event.parsedBody || {}) as DeleteBanBody;

	if (!serverID) {
		return ResponseUtil.ValidationError("ServerID is required");
	}
	if (!ticketNumber) {
		return ResponseUtil.ValidationError("Ticket number is required");
	}
	if (fullDelete === undefined) {
		return ResponseUtil.ValidationError("FullDelete is required");
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
		const status = await TShock.APIRequest(userID!, "/v3/bans/destroy", { ticketNumber, fullDelete });

		CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userID,
			action: "delete-ban",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { instanceIP, instanceID: serverID, status },
		});

		return ResponseUtil.Success({ success: true });
	} catch (e: any) {
		return ResponseUtil.Error(e.message || "Failed to destroy ban entry");
	}
};
