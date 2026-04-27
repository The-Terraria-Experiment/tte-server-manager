import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { TShockAPI } from "../utils/TShockAPI.js";
import { Assert } from "../shared/utils/Assert.js";

export const reloadConfig = async (event: AuthorizedEvent) => {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverId}`);

	await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "reload-config",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { serverId },
	});

	try {
		const ec2 = new Ec2Dao();
		const instance = await ec2.GetInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === "PENDING") {
			return ResponseUtil.Error(`Instance ${serverId} has no reachable public IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		const userId = Parsers.GetUserSub(event);
		Assert.IsTruthyString(userId, "No user ID");
		const tshock = new TShockAPI(ip);
		await tshock.APIRequest(userId!, "/v3/server/reload");
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to reload server config");
	}

	return ResponseUtil.Success({});
};