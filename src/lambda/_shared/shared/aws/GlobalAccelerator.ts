import {
	DescribeEndpointGroupCommand,
	GlobalAcceleratorClient,
	UpdateEndpointGroupCommand,
	type EndpointDescription,
} from "@aws-sdk/client-global-accelerator";

/**
 * Global Accelerator's control plane, for pointing the public play address at an instance.
 *
 * **GA's API exists only in us-west-2**, whatever region the accelerator's endpoints are in (ours are
 * us-east-2) and whatever region the calling lambda runs in. A client left on the default region
 * fails with an endpoint error, so the region is pinned here rather than taken from the environment.
 */
const GA_CONTROL_PLANE_REGION = "us-west-2";

export type GaEndpoint = {
	endpointId: string,
	weight: number | null,
	healthState: string | null,
};

export class GlobalAcceleratorDao {
	private client = new GlobalAcceleratorClient({ region: GA_CONTROL_PLANE_REGION });

	public async DescribeEndpoints(endpointGroupArn: string): Promise<GaEndpoint[]> {
		const result = await this.client.send(new DescribeEndpointGroupCommand({ EndpointGroupArn: endpointGroupArn }));
		return (result.EndpointGroup?.EndpointDescriptions ?? []).map((endpoint: EndpointDescription) => ({
			endpointId: endpoint.EndpointId ?? "",
			weight: endpoint.Weight ?? null,
			healthState: endpoint.HealthState ?? null,
		}));
	}

	/**
	 * Makes `instanceId` the group's **only** endpoint, in one call.
	 *
	 * `UpdateEndpointGroup`'s `EndpointConfigurations` replaces the whole list, which is what makes the
	 * switch atomic. Adding the new endpoint and then removing the old one would leave a window where
	 * GA spreads new connections across both boxes. Everything else on the group (health check,
	 * traffic dial) is omitted and so left as it is.
	 *
	 * Client IP preservation is on because it is mandatory for EC2 endpoints, and the game servers'
	 * logs and bans depend on seeing real client addresses.
	 */
	public async RouteAllTrafficTo(endpointGroupArn: string, instanceId: string): Promise<void> {
		await this.client.send(new UpdateEndpointGroupCommand({
			EndpointGroupArn: endpointGroupArn,
			EndpointConfigurations: [{ EndpointId: instanceId, Weight: 255, ClientIPPreservationEnabled: true }],
		}));
	}
}
