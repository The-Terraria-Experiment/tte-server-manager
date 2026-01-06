<template>
	<div 
		v-if="$checkPermissions(PERMISSIONS.instance.list) && !loading.list && instanceOptions?.length"
		class="bg-gray-3 p-4 rounded-xl"
	>
		<p class="font-main font-bold text-gray-7 mb-2">VIEW INSTANCE</p>
		<Dropdown 
			:options="instanceOptions"
			v-model="selectedInstance"
			inputClass="bg-teal-3 text-white-1"
			iconColor="text-white-1"
		/>

		<RefreshButton :loading="loading.status" @input="fetchInstanceStatus(selectedInstance)" />
	</div>
	
	<StatusTile v-else-if="!loading.list && !instanceOptions.length">
		<template #header>
			<Icon icon="warning" color="text-yellow-2" size="4" />
			<p class="text-yellow-2 ml-2 text-lg">No Data</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">No instances to show</p>
		</template>
	</StatusTile>

	<template v-if="$checkPermissions(PERMISSIONS.instance.status.read)">
		<div class="flex flex-col sm:grid sm:grid-cols-4">
			<StatusTile 
				:class="['grow mt-4 sm:mt-8 sm:mr-1', selectedInstanceData.state === 'ONLINE' ? 'gradient-tile-green' : 'gradient-tile-red']" 
				:collapsible="['ONLINE', 'OFFLINE'].includes(selectedInstanceData.state)"
			>
				<template #header>
					<Icon icon="power" color="text-gray-6" size="4" />
					<p class="text-gray-6 ml-2 text-lg">Instance Status</p>
				</template>
				<template #summary>
					<div class="flex items-center">
						<p class="text-2xl text-teal-4">{{ selectedInstanceData.state }}</p>
						<Spinner v-if="loading.stateChange" class="h-6 w-6 text-teal-3 ml-2"/>
					</div>
				</template>
				<template #content>
					<div v-if="selectedInstanceData.state === 'ONLINE'">
						<FlexButton 
							v-if="$checkPermissions(PERMISSIONS.instance.status.stop) && !loading.stateChange"
							class="mx-4 mb-4" 
							:variant="BTN_VARIANT.DANGER"
							@input="stopInstance"
						>
							<p class="py-2 px-12">STOP</p>
						</FlexButton>
						<FlexButton 
							v-if="$checkPermissions(PERMISSIONS.instance.status.restart) && !loading.stateChange"
							class="mx-4 mb-4" 
							:variant="BTN_VARIANT.DANGER"
							@input="restartInstance"
						>
							<p class="py-2 px-12">RESTART</p>
						</FlexButton>
					</div>
					<div v-if="selectedInstanceData.state === 'OFFLINE'">
						<FlexButton 
							v-if="$checkPermissions(PERMISSIONS.instance.status.start) && !loading.stateChange"
							class="mx-4 mb-4" 
							:variant="BTN_VARIANT.PRIMARY"
							@input="startInstance"
						>
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
import { get, post } from '../../util/api';
import NotAllowed from '../common/NotAllowed.vue';
import RefreshButton from '../common/RefreshButton.vue';
import delay from '../../util/delay';

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
		RefreshButton,
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
				stateChange: false,
			},
			instanceData: {},
			instanceOptions: [],
		}
	},
	computed: {
		selectedInstanceData() {
			const rawData = this.instanceData[this.selectedInstance];
			if (!rawData) return {
				state: "UNKNOWN",
				publicIp: null,
				timeOnline: null,
				instanceType: null
			};

			const stateMap = {
				"pending": "STARTING",
				"running": "ONLINE",
				"shutting-down": "SHUTTING DOWN",
				"terminated": "TERMINATED",
				"stopping": "STOPPING",
				"stopped": "OFFLINE"
			};

			return {
				state: stateMap[rawData.state],
				publicIp: rawData.publicIp,
				timeOnline: (rawData.launchTime && rawData.state === 'running') ? new Date(rawData.launchTime) : null,
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
		},
		async stopInstance() {
			this.$validatePermissions(PERMISSIONS.instance.status.stop);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const response = await post(`/instance/${this.selectedInstance}/stop`, PERMISSIONS.instance.status.stop);
				await delay(2000);
				this.$alert.info("Successfully initiated instance shutdown");
				this.fetchInstanceStatus(this.selectedInstance);
			} catch (e) {
				this.$alert.error("Error initiating instance shutdown");
				console.error(e);
			} finally {
				this.loading.stateChange = false;
			}
		},
		async startInstance() {
			this.$validatePermissions(PERMISSIONS.instance.status.start);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const response = await post(`/instance/${this.selectedInstance}/start`, PERMISSIONS.instance.status.start);
				await delay(2000);
				this.$alert.info("Successfully initiated instance startup");
				this.fetchInstanceStatus(this.selectedInstance);
			} catch (e) {
				this.$alert.error("Error initiating instance startup");
				console.error(e);
			} finally {
				this.loading.stateChange = false;
			}
		},
		async restartInstance() {
			this.$validatePermissions(PERMISSIONS.instance.status.restart);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const response = await post(`/instance/${this.selectedInstance}/stop`, PERMISSIONS.instance.status.restart);
				await delay(2000);
				this.$alert.info("Successfully initiated instance restart");
				this.fetchInstanceStatus(this.selectedInstance);
			} catch (e) {
				this.$alert.error("Error initiating instance restart");
				console.error(e);
			} finally {
				this.loading.stateChange = false;
			}
		},
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
