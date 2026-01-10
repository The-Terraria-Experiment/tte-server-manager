<template>
	<div 
		v-if="$checkPermissions(PERMISSIONS.instance.list) && !serverStore.isLoadingList && serverStore.instanceOptions?.length"
		class="bg-gray-3 p-4 rounded-xl"
	>
		<p class="font-main font-bold text-gray-7 mb-2">VIEW INSTANCE</p>
		<Dropdown 
			:options="serverStore.instanceOptions"
			v-model="selectedInstance"
			inputClass="bg-teal-3 text-white-1"
			iconColor="text-white-1"
		/>

		<RefreshButton :loading="serverStore.isLoadingStatus(selectedInstance)" @input="refresh" />
	</div>
	
	<StatusTile v-else-if="!serverStore.isLoadingList && !serverStore.instanceOptions.length">
		<template #header>
			<Icon icon="warning" color="text-yellow-2" size="4" />
			<p class="text-yellow-2 ml-2 text-lg">No Data</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">No instances to show</p>
		</template>
	</StatusTile>

	<MajorLoader v-else-if="serverStore.isLoadingList" text="Loading Instances..."/>

	<BasicInstanceInfo :selected-instance-data="selectedInstanceData" :loading="loading" />

	<InstanceFilePaths :selected-instance-data="selectedInstanceData" />

	<InstanceFiles :selected-instance-data="selectedInstanceData" :loading="loading" />
	
</template>

<script>
import { BTN_VARIANT, } from '../../util/constants';
import Dropdown from '../common/Dropdown.vue';
import { PERMISSIONS } from '../../util/permissionValues';
import RefreshButton from '../common/RefreshButton.vue';
import { useServerStore } from '../../stores/serverStore';
import BasicInstanceInfo from './tools/instance/BasicInstanceInfo.vue';
import InstanceFiles from './tools/instance/InstanceFiles.vue';
import InstanceFilePaths from './tools/instance/InstanceFilePaths.vue';
import MajorLoader from '../shared/MajorLoader.vue';

export default {
	mixins: [],
	components: {
		Dropdown,
		RefreshButton,
		BasicInstanceInfo,
		InstanceFiles,
		InstanceFilePaths,
		MajorLoader,
	},
	props: {
		
	},
	data() {
		return {
			BTN_VARIANT,
			PERMISSIONS,
			selectedInstance: null,
			serverStore: useServerStore(),
			loading: {
				stateChange: false,
				fileUpload: false,
			},
		}
	},
	computed: {
		selectedInstanceData() {
			const rawData = this.serverStore.getInstanceData(this.selectedInstance);
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
				id: this.selectedInstance,
				state: stateMap[rawData.state],
				publicIp: rawData.publicIp,
				timeOnline: (rawData.launchTime && rawData.state === 'running') ? new Date(rawData.launchTime) : null,
				instanceType: rawData.instanceType
			};
		},
	},
	methods: {
		refresh() {
			this.fetchInstanceStatus(this.selectedInstance);
			this.fetchInstanceFiles(this.selectedInstance);
		},

		async fetchInstanceList() {
			this.$validatePermissions(PERMISSIONS.instance.list);

			try {
				const instances = await this.serverStore.fetchInstanceList();
				this.selectedInstance = instances[0]?.id || undefined;
			} catch (e) {
				this.$alert.error("Error fetching instance list");
				console.error(e);
			}
		},

		async fetchInstanceStatus(instanceID) {
			this.$validatePermissions(PERMISSIONS.instance.status.read);

			try {
				await this.serverStore.fetchInstanceStatus(instanceID);
			} catch (e) {
				this.$alert.error("Error fetching instance status");
				console.error(e);
			}
		},

		async fetchInstanceFiles(instanceID) {
			this.$validatePermissions(PERMISSIONS.instance.files.read);

			try {
				await this.serverStore.fetchInstanceFiles(instanceID);
			} catch (e) {
				this.$alert.error("Error fetching instance files");
				console.error(e);
			}
		},
	},
	async mounted() {
		if (this.$checkPermissions(PERMISSIONS.instance.list)) {
			await this.fetchInstanceList();
			if (this.$checkPermissions(PERMISSIONS.instance.files.read)) {
				this.fetchInstanceFiles(this.selectedInstance);
			}
		}
	},
	watch: {
		selectedInstance(value) {
			if (!this.serverStore.getInstanceData(value) && !this.serverStore.isLoadingStatus(value)) {
				this.fetchInstanceStatus(value);
				if (this.$checkPermissions(PERMISSIONS.instance.files.read)) {
					this.fetchInstanceFiles(this.selectedInstance);
				}
			}
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";

</style>
