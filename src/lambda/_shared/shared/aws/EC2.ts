import {
	DescribeInstancesCommand,
	EC2Client,
	RebootInstancesCommand,
	StartInstancesCommand,
	StopInstancesCommand,
} from "@aws-sdk/client-ec2";
import { CWLogger } from "./CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";
import { Delay } from "../utils/Delay.js";

export const InstanceState = {
	PENDING: "pending",
	RUNNING: "running",
	SHUTDOWN: "shutting-down",
	TERMINATED: "terminated",
	STOPPING: "stopping",
	STOPPED: "stopped",
	UNKNOWN: "unknown",
	/**
	 * Registered in the instance registry, but EC2 has no such instance — typically a terminated box
	 * or a typo'd ID. Never returned by AWS; synthesised by GetMultipleInstanceStatus so one bad
	 * registry entry degrades to a single flagged row instead of failing the whole list.
	 */
	MISSING: "missing"
} as const;

type InstanceState = (typeof InstanceState)[keyof typeof InstanceState];

// Type guard: ensures value is a known InstanceState
function isKnownInstanceState(value: any): value is InstanceState {
    return Object.values(InstanceState).includes(value);
}

// Safe converter for AWS responses
function toInstanceState(awsStateValue: string | undefined): InstanceState {
    return awsStateValue && isKnownInstanceState(awsStateValue) 
        ? awsStateValue 
        : InstanceState.UNKNOWN;
}

export interface InstanceStatus {
	state: InstanceState;
	publicIp: string;
	launchTime: Date | undefined;
	instanceType: string | undefined;
	name: string;
}

export interface MultiInstanceStatus extends InstanceStatus {
	id: string;
}

export class Ec2Dao {
	private readonly ec2Client: EC2Client;

	constructor(region = process.env.AWS_REGION) {
		this.ec2Client = new EC2Client({ region: region || "us-east-2" });
	}

	public async GetInstanceStatus(instanceId: string): Promise<InstanceStatus> {
		const command = new DescribeInstancesCommand({
			InstanceIds: [instanceId],
		});
		const response = await this.ec2Client.send(command);

		if (!response.Reservations || response.Reservations.length === 0) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		const reservation = response.Reservations[0];
		if (!reservation || !reservation.Instances || reservation.Instances.length === 0) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		const instance = reservation.Instances[0];
		if (!instance) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		const nameTag = instance.Tags?.find((tag) => tag.Key === "Name");

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-get-instance-status",
			resource: null,
			details: { instanceId },
		});

		return {
			state: toInstanceState(instance.State?.Name ?? "unknown"),
			publicIp: instance.PublicIpAddress || "PENDING",
			launchTime: instance.LaunchTime,
			instanceType: instance.InstanceType,
			name: nameTag?.Value || "(Unnamed)",
		};
	}

	/**
	 * Describes several instances at once, tolerating IDs EC2 no longer knows about.
	 *
	 * DescribeInstances with an explicit InstanceIds list is all-or-nothing: a single terminated or
	 * typo'd ID throws InvalidInstanceID.NotFound and takes the entire response with it. Since the
	 * caller's ID list now comes from the instance registry, which admins edit, one stale entry would
	 * otherwise blank the instance list — including the UI needed to remove it. So on that error we
	 * fall back to describing each ID on its own and return the unresolvable ones as `missing`.
	 *
	 * @returns One entry per requested ID, in the order requested.
	 */
	public async GetMultipleInstanceStatus(instanceIds: string[]): Promise<MultiInstanceStatus[]> {
		if (!instanceIds || instanceIds.length === 0) {
			return [];
		}

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-get-multiple-instance-status",
			resource: null,
			details: { instanceIds },
		});

		let found: Map<string, MultiInstanceStatus>;
		try {
			found = await this.DescribeInstancesById(instanceIds);
		} catch (error) {
			if (!Ec2Dao.IsUnknownInstanceIdError(error)) {
				throw error;
			}

			// At least one ID is bad, but EC2 doesn't say which. Re-describe individually so the
			// good ones still resolve.
			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				details: {
					action: "getMultipleInstanceStatus",
					note: "batch describe rejected an unknown instance id; falling back to per-id describe",
					instanceIds,
				},
			});

			found = new Map();
			const perId = await Promise.all(
				instanceIds.map(async (id) => {
					try {
						return await this.DescribeInstancesById([id]);
					} catch (individualError) {
						if (Ec2Dao.IsUnknownInstanceIdError(individualError)) {
							return new Map<string, MultiInstanceStatus>();
						}
						throw individualError;
					}
				}),
			);
			for (const result of perId) {
				for (const [id, status] of result) {
					found.set(id, status);
				}
			}
		}

		return instanceIds.map(
			(id) =>
				found.get(id) ?? {
					id,
					state: InstanceState.MISSING,
					publicIp: "UNKNOWN",
					launchTime: undefined,
					instanceType: undefined,
					name: "(Not found in EC2)",
				},
		);
	}

	private async DescribeInstancesById(instanceIds: string[]): Promise<Map<string, MultiInstanceStatus>> {
		const response = await this.ec2Client.send(new DescribeInstancesCommand({ InstanceIds: instanceIds }));

		const instances = new Map<string, MultiInstanceStatus>();
		for (const reservation of response.Reservations || []) {
			for (const instance of reservation.Instances || []) {
				if (!instance.InstanceId) {
					continue;
				}
				const nameTag = instance.Tags?.find((tag) => tag.Key === "Name");
				instances.set(instance.InstanceId, {
					id: instance.InstanceId,
					state: toInstanceState(instance.State?.Name ?? "unknown"),
					publicIp: instance.PublicIpAddress || "PENDING",
					launchTime: instance.LaunchTime,
					instanceType: instance.InstanceType,
					name: nameTag?.Value || "(Unnamed)",
				});
			}
		}
		return instances;
	}

	private static IsUnknownInstanceIdError(error: unknown): boolean {
		const code = (error as { name?: string; Code?: string })?.name || (error as { Code?: string })?.Code || "";
		return code.startsWith("InvalidInstanceID");
	}

	public async StartInstance(instanceId: string): Promise<{ state: string }> {
		const command = new StartInstancesCommand({
			InstanceIds: [instanceId],
		});
		const response = await this.ec2Client.send(command);
		const instance = response.StartingInstances?.[0];

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-start-instance",
			resource: null,
			details: { instanceId },
		});

		return {
			state: instance?.CurrentState?.Name ?? "unknown",
		};
	}

	public async StartInstanceAndAwait(instanceId: string, intervalMs: number = 1000, max: number = 30): Promise<InstanceStatus> {
		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-start-instance-and-wait",
			resource: null,
			details: { instanceId },
		});

		await this.StartInstance(instanceId);

		for (let i = 0; i < max; i++) {
			await new Delay(intervalMs);
			const result = await this.GetInstanceStatus(instanceId);
			if (result.state === InstanceState.RUNNING) {
				return result;
			}
		}

		throw new Error(`Awaiting instance startup timed out`);
	}

	public async StopInstance(instanceId: string): Promise<{ state: string }> {
		const command = new StopInstancesCommand({
			InstanceIds: [instanceId],
		});
		const response = await this.ec2Client.send(command);
		const instance = response.StoppingInstances?.[0];

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-stop-instance",
			resource: null,
			details: { instanceId },
		});

		return {
			state: instance?.CurrentState?.Name ?? "unknown",
		};
	}

	public async RebootInstance(instanceId: string): Promise<void> {
		const command = new RebootInstancesCommand({
			InstanceIds: [instanceId],
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-reboot-instance",
			resource: null,
			details: { instanceId },
		});

		await this.ec2Client.send(command);
	}
}
