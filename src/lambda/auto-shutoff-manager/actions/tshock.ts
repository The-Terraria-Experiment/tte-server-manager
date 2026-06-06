import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { TShockAPI } from "../shared/utils/TShockAPI.js";

const AUTO_SHUTOFF_USER_ID = "[auto-shutoff]";

export type TShockTarget = {
	serverId: string;
	ip: string;
	tshock: TShockAPI;
};

export async function getTShockTarget(serverId: string): Promise<TShockTarget | null> {
	const ec2 = new Ec2Dao();
	try {
		const instance = await ec2.GetInstanceStatus(serverId);
		if (instance.state !== InstanceState.RUNNING) {
			await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
				userId: AUTO_SHUTOFF_USER_ID,
				action: "skip",
				status: "instance-not-running",
				resource: serverId,
				details: { state: instance.state },
			});
			return null;
		}

		if (!instance.publicIp || instance.publicIp === "PENDING") {
			await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
				userId: AUTO_SHUTOFF_USER_ID,
				action: "skip",
				status: "instance-ip-unavailable",
				resource: serverId,
				details: { state: instance.state },
			});
			return null;
		}

		return {
			serverId,
			ip: instance.publicIp,
			tshock: new TShockAPI(instance.publicIp),
		};
	} catch (error) {
		await CWLogger.Error(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "instance-status",
			error: error instanceof Error ? error.message : String(error),
			details: { serverId },
		});
		return null;
	}
}

export async function broadcastWarning(target: TShockTarget, message: string): Promise<boolean> {
	const response = await callTShock(target, "/v2/server/broadcast", { msg: message });
	if (!response) {
		return false;
	}

	await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
		userId: AUTO_SHUTOFF_USER_ID,
		action: "broadcast-warning",
		resource: target.serverId,
		details: { ip: target.ip, message },
	});

	return true;
}

export async function stopServer(target: TShockTarget, message: string): Promise<boolean> {
	const response = await callTShock(target, "/v2/server/off", { confirm: true, message });
	if (!response) {
		return false;
	}

	await CWLogger.Action(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
		userId: AUTO_SHUTOFF_USER_ID,
		action: "stop-server",
		resource: target.serverId,
		details: { ip: target.ip },
	});

	return true;
}

async function callTShock(
	target: TShockTarget,
	endpoint: string,
	params: Record<string, any> | undefined = undefined,
): Promise<Record<string, any> | null> {
	try {
		const response = await target.tshock.APIRequest(AUTO_SHUTOFF_USER_ID, endpoint, params);
		const normalized = normalizeTShockPayload(response);
		if (normalized?.server?.status === false) {
			return null;
		}
		return normalized;
	} catch (error) {
		await CWLogger.Error(FUNC_NAMES.AUTO_SHUTOFF_MGR, {
			userId: AUTO_SHUTOFF_USER_ID,
			action: "tshock-call",
			error: error instanceof Error ? error.message : String(error),
			details: { endpoint, serverId: target.serverId },
		});
		return null;
	}
}

function normalizeTShockPayload(payload: Record<string, any> | null): Record<string, any> | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}

	if (typeof (payload as any).statusCode === "number" && typeof (payload as any).body === "string") {
		try {
			return JSON.parse((payload as any).body);
		} catch {
			return null;
		}
	}

	return payload;
}
