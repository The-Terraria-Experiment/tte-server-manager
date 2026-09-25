import { GlobalAcceleratorDao } from "../../aws/GlobalAccelerator.js";
import { Ec2Dao } from "../../aws/EC2.js";
import { InstanceRegistry } from "./InstanceRegistry.js";

/**
 * Which instance the public play address (`play.theterrariaexperiment.com`, a CNAME to the Global
 * Accelerator) currently reaches.
 *
 * **Global Accelerator itself is the source of truth.** Nothing is copied into Dynamo, so a change
 * made in the AWS console reads back correctly, and there is no second record to drift. Switching is
 * one `UpdateEndpointGroup` that replaces the endpoint list (`GlobalAcceleratorDao.RouteAllTrafficTo`);
 * DNS never changes.
 *
 * Configured per environment by `GA_ENDPOINT_GROUP_ARN` (+ `GA_PUBLIC_HOSTNAME` for display), read
 * raw so leaving it unset turns the feature off rather than failing. The accelerator is shared by prod
 * and stage exactly as the EC2 fleet is, so both environments point at the same group and see the
 * same answer.
 */

export type PublicAddressTarget = {
	instanceId: string,
	/** The instance's EC2 Name tag (else its registry name), or null when it has neither. */
	name: string | null,
	/** GA's view: HEALTHY / UNHEALTHY / INITIAL. The health check is TCP 3891, so "no server running" reads UNHEALTHY. */
	healthState: string | null,
};

export type PublicAddressState =
	| { configured: false }
	| {
		configured: true,
		hostname: string | null,
		/** The single target, or null when there are none or several (see `mixed`). */
		targetInstanceId: string | null,
		targets: PublicAddressTarget[],
		/** More than one endpoint: someone split traffic in the console. The switch collapses it back to one. */
		mixed: boolean,
	};

/** The endpoint group ARN, or null when this environment has the feature switched off. */
export const publicAddressGroupArn = (): string | null => process.env.GA_ENDPOINT_GROUP_ARN?.trim() || null;

export async function readPublicAddress(): Promise<PublicAddressState> {
	const groupArn = publicAddressGroupArn();
	if (!groupArn) {
		return { configured: false };
	}

	const endpoints = await new GlobalAcceleratorDao().DescribeEndpoints(groupArn);
	// Names come from the EC2 Name tag, not this environment's instance list: the accelerator is shared,
	// so its target can be a box registered only for the *other* environment, which the caller's list
	// doesn't contain. The registry's own `name` is a fallback; it is usually empty.
	const statuses = await new Ec2Dao().GetMultipleInstanceStatus(endpoints.map((endpoint) => endpoint.endpointId));
	const tagNames = new Map(statuses.map((status) => [status.id, status.name]));
	const targets: PublicAddressTarget[] = await Promise.all(endpoints.map(async (endpoint) => ({
		instanceId: endpoint.endpointId,
		name: tagNames.get(endpoint.endpointId)
			|| (await InstanceRegistry.GetEntry(endpoint.endpointId))?.name
			|| null,
		healthState: endpoint.healthState,
	})));

	return {
		configured: true,
		hostname: process.env.GA_PUBLIC_HOSTNAME?.trim() || null,
		targetInstanceId: targets.length === 1 ? targets[0]!.instanceId : null,
		targets,
		mixed: targets.length > 1,
	};
}
