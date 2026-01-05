<template>
	<Dropdown 
		:options="instanceOptions"
		v-model="selectedInstance"
		inputClass="bg-teal-3 text-white-1"
		iconColor="text-white-1"
	/>

	<template v-if="selectedInstance">
		<div class="flex flex-col sm:grid sm:grid-cols-4">
			<StatusTile 
				:class="['grow mt-4 sm:mt-8 sm:mr-1', selectedInstanceData.state === 'ONLINE' ? 'gradient-tile-green' : 'gradient-tile-red']" 
				collapsible
			>
				<template #header>
					<Icon icon="power" color="text-gray-6" size="4" />
					<p class="text-gray-6 ml-2 text-lg">Instance Status</p>
				</template>
				<template #summary>
					<p class="text-2xl text-teal-4">{{ selectedInstanceData.state }}</p>
				</template>
				<template #content>
					<div v-if="selectedInstanceData.state === 'ONLINE'">
						<FlexButton class="mx-4 mb-4" :variant="BTN_VARIANT.DANGER">
							<p class="py-2 px-12">STOP</p>
						</FlexButton>
						<FlexButton class="mx-4 mb-4" :variant="BTN_VARIANT.DANGER">
							<p class="py-2 px-12">RESTART</p>
						</FlexButton>
					</div>
					<div v-if="selectedInstanceData.state === 'OFFLINE'">
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
					<ActiveDate 
						v-if="selectedInstanceData.timeOnline" 
						:date="selectedInstanceData.timeOnline"
						class-name="font-main font-bold text-teal-4 text-2xl"
					/>
					<p v-else class="text-2xl text-teal-4">Unknown</p>
				</template>
			</StatusTile>

			<StatusTile class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile">
				<template #header>
					<Icon icon="clock" color="text-gray-6" size="4" />
					<p class="text-gray-6 ml-2 text-lg">IP Address</p>
				</template>
				<template #summary>
					<p v-if="selectedInstanceData.publicIp" class="text-2xl text-teal-4">{{ selectedInstanceData.publicIp }}</p>
					<p v-else class="text-2xl text-teal-4">Unknown</p>
				</template>
			</StatusTile>

			<StatusTile class="grow mt-4 sm:mt-8 sm:ml-1 gradient-tile">
				<template #header>
					<Icon icon="clock" color="text-gray-6" size="4" />
					<p class="text-gray-6 ml-2 text-lg">Instance Type</p>
				</template>
				<template #summary>
					<p v-if="selectedInstanceData.instanceType" class="text-2xl text-teal-4">{{ selectedInstanceData.instanceType }}</p>
					<p v-else class="text-2xl text-teal-4">Unknown</p>
				</template>
			</StatusTile>
		</div>
	</template>
	<template v-else>
		<div class="flex">
			<Spinner class="h-6 w-6 text-white-0" thickness="4" />
			<p class="font-main font-semibold">Loading...</p>
		</div>
		
	</template>
	
</template>

<script>
import { BTN_VARIANT } from '../../util/constants';
import Dropdown from '../common/Dropdown.vue';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import StatusTile from '../common/StatusTile.vue';
import Spinner from "../common/Spinner.vue";
import ActiveDate from '../common/ActiveDate.vue';

export default {
	mixins: [],
	components: {
		Dropdown,
		StatusTile,
		FlexButton,
		Icon,
		Spinner,
		ActiveDate,
	},
	props: {
		
	},
	data() {
		return {
			BTN_VARIANT,
			selectedInstance: null,
			instanceData: {
				"instance-1": {
					state: "running",
					publicIp: "192.168.0.0",
					launchTime: "2024-09-29T11:04:43.305Z",
					instanceType: "m6a.large",
				},
				"instance-2": {
					state: "stopped",
					publicIp: "192.168.1.2",
					launchTime: "2021-09-29T11:04:43.305Z",
					instanceType: "t2.micro",
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
		},
		selectedInstanceData() {
			const rawData = this.instanceData[this.selectedInstance];
			const stateMap = {
				"pending": "STATE PENDING",
				"running": "ONLINE",
				"shutting-down": "SHUTTING DOWN",
				"terminated": "TERMINATED",
				"stopping": "STOPPING",
				"stopped": "OFFLINE"
			};

			return {
				state: stateMap[rawData.state],
				publicIp: rawData.publicIp,
				timeOnline: rawData.launchTime ? new Date(rawData.launchTime) : null,
				instanceType: rawData.instanceType
			};
		}
	},
	methods: {
		
	},
	mounted() {
		this.selectedInstance = "instance-2";
	}
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
