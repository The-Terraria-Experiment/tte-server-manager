<template>
	<Dropdown 
		v-if="$checkPermissions(PERMISSIONS.instance.list) && !loading.list && instanceOptions?.length"
		:options="instanceOptions"
		v-model="selectedInstance"
		inputClass="bg-teal-3 text-white-1"
		iconColor="text-white-1"
	/>
	<StatusTile v-else-if="!loading.list && !instanceOptions.length">
		<template #header>
			<Icon icon="warning" color="text-yellow-2" size="4" />
			<p class="text-yellow-2 ml-2 text-lg">No Data</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">No instances to show</p>
		</template>
	</StatusTile>

	<template v-if="loading.list || loading.status">
		<div class="flex items-center py-4">
			<Spinner class="h-4 w-4 text-white-0" thickness="4" />
			<p class="font-main font-semibold text-white-0 ml-2">Loading...</p>
		</div>
	</template>
	<template v-else-if="$checkPermissions(PERMISSIONS.instance.status.read) && selectedInstanceData && instanceOptions">
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
					<Icon icon="network" color="text-gray-6" size="5" />
					<p class="text-gray-6 ml-2 text-lg">IP Address</p>
				</template>
				<template #summary>
					<p v-if="selectedInstanceData.publicIp" class="text-2xl text-teal-4">{{ selectedInstanceData.publicIp }}</p>
					<p v-else class="text-2xl text-teal-4">Unknown</p>
				</template>
			</StatusTile>

			<StatusTile class="grow mt-4 sm:mt-8 sm:ml-1 gradient-tile">
				<template #header>
					<Icon icon="microchip" color="text-gray-6" size="5" />
					<p class="text-gray-6 ml-2 text-lg">Instance Type</p>
				</template>
				<template #summary>
					<p v-if="selectedInstanceData.instanceType" class="text-2xl text-teal-4">{{ selectedInstanceData.instanceType }}</p>
					<p v-else class="text-2xl text-teal-4">Unknown</p>
				</template>
			</StatusTile>
		</div>
	</template>
	<NotAllowed v-else-if="!$checkPermissions(PERMISSIONS.instance.status.read)" />
	
</template>

<script>
import { BTN_VARIANT } from '../../util/constants';
import Dropdown from '../common/Dropdown.vue';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import StatusTile from '../common/StatusTile.vue';
import Spinner from "../common/Spinner.vue";
import ActiveDate from '../common/ActiveDate.vue';
import { PERMISSIONS } from '../../util/permissionValues';
import { get } from '../../util/api';
import NotAllowed from '../common/NotAllowed.vue';

export default {
	mixins: [],
	components: {
		Dropdown,
		StatusTile,
		FlexButton,
		Icon,
		Spinner,
		ActiveDate,
		NotAllowed,
	},
	props: {
		
	},
	data() {
		return {
			BTN_VARIANT,
			PERMISSIONS,
			selectedInstance: null,
			loading: {
				list: false,
				status: false,
			},
			instanceData: {},
			instanceOptions: [],
		}
	},
	computed: {
		selectedInstanceData() {
			const rawData = this.instanceData[this.selectedInstance];
			if (!rawData) return null;

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
		async fetchInstanceList() {
			this.$validatePermissions(PERMISSIONS.instance.list);

			if (this.loading.list) return;
			this.loading.list = true;

			try {
				const instanceList = await get("/instances", PERMISSIONS.instance.list);
				this.instanceOptions = instanceList.instances.map?.(i => ({ id: i.id, text: i.name }));
				this.selectedInstance = instanceList.instances[0]?.id || undefined;
				if (this.selectedInstance) {
					this.fetchInstanceStatus(this.selectedInstance);
				}
			} catch (e) {
				this.$alert.error("Error fetching instance list");
				console.error(e);
			} finally {
				this.loading.list = false;
			}
		},
		async fetchInstanceStatus(instanceID) {
			this.$validatePermissions(PERMISSIONS.instance.status.read);

			if (this.loading.status) return;
			this.loading.status = true;

			try {
				const instanceStatus = await get(`/instance/${instanceID}/status`, PERMISSIONS.instance.status.read);
				this.instanceData[instanceID] = instanceStatus.instance;
			} catch (e) {
				this.$alert.error("Error fetching instance status");
				console.error(e);
			} finally {
				this.loading.status = false;
			}
		}
	},
	mounted() {
		if (this.$checkPermissions(PERMISSIONS.instance.list)) {
			this.fetchInstanceList();
		}
	},
	watch: {
		selectedInstance(value) {
			if (!this.instanceData[value] && !this.loading.status) {
				this.fetchInstanceStatus(value);
			}
		}
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
