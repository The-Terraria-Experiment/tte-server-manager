import {
	DescribeInstancesCommand,
	EC2Client,
	RebootInstancesCommand,
	StartInstancesCommand,
	StopInstancesCommand,
} from "@aws-sdk/client-ec2";
import { CWLogger } from "./CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";

export const InstanceState = {
	PENDING: "pending",
	RUNNING: "running",
	SHUTDOWN: "shutting-down",
	TERMINATED: "terminated",
	STOPPING: "stopping",
	STOPPED: "stopped",
	UNKNOWN: "unknown"
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

	public async GetMultipleInstanceStatus(instanceIds: string[]): Promise<MultiInstanceStatus[]> {
		if (!instanceIds || instanceIds.length === 0) {
			return [];
		}

		const command = new DescribeInstancesCommand({
			InstanceIds: instanceIds,
		});
		const response = await this.ec2Client.send(command);

		const instances: MultiInstanceStatus[] = [];
		for (const reservation of response.Reservations || []) {
			for (const instance of reservation.Instances || []) {
				const nameTag = instance.Tags?.find((tag) => tag.Key === "Name");
				instances.push({
					id: instance.InstanceId || "",
					state: toInstanceState(instance.State?.Name ?? "unknown"),
					publicIp: instance.PublicIpAddress || "PENDING",
					launchTime: instance.LaunchTime,
					instanceType: instance.InstanceType,
					name: nameTag?.Value || "(Unnamed)",
				});
			}
		}

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-get-multiple-instance-status",
			resource: null,
			details: { instanceIds },
		});

		return instances;
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
