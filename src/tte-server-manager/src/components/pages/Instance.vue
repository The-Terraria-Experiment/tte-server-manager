<template>
	<Dropdown 
		:options="instanceOptions"
	/>

	<div class="flex flex-col sm:flex-row">
		<StatusTile class="grow mt-4 sm:mt-8 sm:mr-1 gradient-tile-red" collapsible>
			<template #header>
				<Icon icon="power" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Instance Status</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">ONLINE</p>
			</template>
			<template #content>
				<div>
					<FlexButton class="mx-4 mb-4" :variant="BTN_VARIANT.DANGER">
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
					<FlexButton class="mx-4 mb-4" :variant="BTN_VARIANT.DANGER">
						<p class="py-2 px-12">RESTART</p>
					</FlexButton>
				</div>
				<div>
					<FlexButton class="mx-4 mb-4" :variant="BTN_VARIANT.PRIMARY">
						<p class="py-2 px-12">START</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<StatusTile class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile">
			<template #header>
				<Icon icon="clock" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Instance Uptime</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">Unknown</p>
			</template>
		</StatusTile>

		<StatusTile class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile">
			<template #header>
				<Icon icon="clock" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">IP Address</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">Unknown</p>
			</template>
		</StatusTile>

		<StatusTile class="grow mt-4 sm:mt-8 sm:ml-1 gradient-tile">
			<template #header>
				<Icon icon="clock" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Instance Type</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">Unknown</p>
			</template>
		</StatusTile>
	</div>
	
</template>

<script>
import { BTN_VARIANT } from '../../util/constants';
import Dropdown from '../common/Dropdown.vue';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import StatusTile from '../common/StatusTile.vue';

/*
instance status endpoint returns
{
	instance: {
		state: instance.State.Name,
		publicIp: instance.PublicIpAddress || "pending",
		launchTime: instance.LaunchTime?.toISOString(),
		instanceType: instance.InstanceType,
		availabilityZone: instance.Placement.AvailabilityZone,
	}
}
*/

export default {
	mixins: [],
	components: {
		Dropdown,
		StatusTile,
		FlexButton,
		Icon,
	},
	props: {
		
	},
	data() {
		return {
			BTN_VARIANT,
			instanceData: {
				"instance-1": {
					state: "Running",
					publicIp: "192.168.0.0",
					launchTime: "2021-09-29T11:04:43.305Z",
					
				}
			}
		}
	},
	computed: {
		instanceOptions() {
			return [
				{ id: "instance-1", text: "Instance 1" },
				{ id: "instance-2", text: "Instance 2" },
			]
		}
	},
	methods: {
		
	},
}
</script>

<style scoped>
@reference "../../theme.css";

.gradient-tile-green {
	@apply bg-linear-to-b from-gray-3 to-green-2 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
	/* transition: background-position 200ms ease; */
}

.gradient-tile-red {
	@apply bg-linear-to-b from-gray-3 to-red-900 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
}
</style>
