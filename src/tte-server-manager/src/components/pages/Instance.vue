<template>
	<div :class="['bg-gray-3 rounded-xl overflow-hidden h-max w-full p-4 mb-4 sm:mb-8 server-bg']">
		<div class="title-bg-gradient"></div>
		<h1 class="font-main font-bold text-white-1 sm:text-teal-4 text-2xl relative z-20 sm:z-0">MANAGE INSTANCE</h1>
		<p class="font-main font-bold text-gray-8 sm:text-gray-7 mt-2 relative z-20 sm:z-0">View machine status and manage files</p>
	</div>
	
	<div 
		v-if="$checkPermissions(PERMISSIONS.instance.list) && !serverStore.isLoadingList && filteredInstanceOptions?.length"
		class="bg-gray-3 p-4 rounded-xl"
	>
		<p class="font-main font-bold text-gray-7 mb-2">VIEW INSTANCE</p>
		<Dropdown 
			:options="filteredInstanceOptions"
			v-model="selectedInstance"
			inputClass="bg-teal-3 text-white-1"
			iconColor="text-white-1"
		/>

		<RefreshButton :loading="serverStore.isLoadingStatus(selectedInstance)" @input="refresh" :refresh-at="autoRefreshAt" />
	</div>
	
	<StatusTile v-else-if="!serverStore.isLoadingList && !filteredInstanceOptions.length">
		<template #header>
			<Icon icon="warning" color="text-yellow-2" size="4" />
			<p class="text-yellow-2 ml-2 text-lg">No Data</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">No instances to show</p>
		</template>
	</StatusTile>

	<MajorLoader v-else-if="serverStore.isLoadingList" text="Loading Instances..."/>

	<BasicInstanceInfo 
	v-if="selectedInstance"
		:selected-instance-data="selectedInstanceData" 
		:loading="loading" 
		@autoRefreshAt="autoRefreshAt = $event" 
	/>

	<InstanceFilePaths 
	v-if="selectedInstance"
		:selected-instance-data="selectedInstanceData" 
	/>

	<InstanceFiles 
	v-if="selectedInstance"
		:selected-instance-data="selectedInstanceData" 
		:loading="loading" 
	/>
	
</template>

<script>
import { BTN_VARIANT, INSTANCE_STATES, } from '../../util/constants';
import Dropdown from '../common/Dropdown.vue';
import { PERMISSIONS } from '../../util/permissionValues';
import RefreshButton from '../common/RefreshButton.vue';
import { useServerStore } from '../../stores/serverStore';
import { useUserStore } from '../../stores/userStore';
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
			userStore: useUserStore(),
			loading: {
				stateChange: false,
				fileUpload: false,
			},
			autoRefreshAt: null
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
				"pending": INSTANCE_STATES.STARTING,
				"running": INSTANCE_STATES.ONLINE,
				"shutting-down": INSTANCE_STATES.SHUTTING_DOWN,
				"terminated": INSTANCE_STATES.TERMINATED,
				"stopping": INSTANCE_STATES.STOPPING,
				"stopped": INSTANCE_STATES.OFFLINE
			};

			return {
				id: this.selectedInstance,
				state: stateMap[rawData.state],
				publicIp: rawData.publicIp,
				timeOnline: (rawData.launchTime && rawData.state === 'running') ? new Date(rawData.launchTime) : null,
				instanceType: rawData.instanceType
			};
		},
		filteredInstanceOptions() {
			return this.serverStore.instanceOptions.filter(i => this.$checkResourceAccess(`instance::${i.id}`));
		}
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
				instances.forEach(i => {
					if (this.$checkResourceAccess(`instance::${i.id}`)) {
						this.selectedInstance = i.id;
					}
				});
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
			if (this.$checkPermissions(PERMISSIONS.instance.files.read) && this.$checkResourceAccess(`instance::${this.selectedInstance}`)) {
				this.fetchInstanceFiles(this.selectedInstance);
			}
		}
	},
	watch: {
		selectedInstance(value) {
			if (!this.serverStore.getInstanceData(value) && !this.serverStore.isLoadingStatus(value) && this.$checkResourceAccess(`instance::${value}`)) {
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

.server-bg {
	background-image: url('/images/abstract-orange.avif');
	/* background-image: url('public/images/server-wallpaper.jpg'); */
	background-position: right center;
	background-repeat: no-repeat;
	@apply relative bg-size-[50%];
}

.server-bg .title-bg-gradient {
	@apply h-full w-1/2 bg-linear-to-l from-transparent to-gray-3 absolute right-0 top-0 z-10;
}
</style>
