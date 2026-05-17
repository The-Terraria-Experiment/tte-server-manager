import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { InstanceState } from "../shared/aws/EC2.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Ec2Dao } from "../shared/aws/EC2.js";
import { TShockAPI } from "../utils/TShockAPI.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Assert } from "../shared/utils/Assert.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { SYSTEM_TABLE, WORLD_CREATE_KEY } from "../shared/vars.js";
import type { SystemWorldCreateEntry } from "../shared/schema/SystemTable.js";

export const getStatus = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return ResponseUtil.ValidationError("ServerID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverId}`);

	try {
		const ec2 = new Ec2Dao();
		const instance = await ec2.GetInstanceStatus(serverId);
		const ip = instance.publicIp;

		if (!ip || ip === "PENDING") {
			return ResponseUtil.Error(`Instance ${serverId} has no reachable public IP`, 503, "INSTANCE_IP_UNAVAILABLE");
		}

		if (instance.state !== InstanceState.RUNNING) {
			return ResponseUtil.Success({ server: { status: false }, instance });
		}

		const DB = new DynamoDao();
		const createWorldStatus = await DB.GetItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${serverId}`) as SystemWorldCreateEntry;

		if (createWorldStatus) {
			return ResponseUtil.Success({ server: { status: false }, instance });
		}

		const userId = Parsers.GetUserSub(event);
		const tshock = new TShockAPI(ip);
		Assert.IsTruthyString(userId, "No user ID");
		const status = await tshock.APIRequest(userId!, "/v2/server/status", { players: true, rules: true });
		const playerData = await tshock.APIRequest(userId!, "/v2/players/list");

		await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: userId,
			action: "get-status",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { ip, instanceId: serverId, status },
		});

		return ResponseUtil.Success({ server: status, players: playerData, instance });
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to fetch server status");
	}
};