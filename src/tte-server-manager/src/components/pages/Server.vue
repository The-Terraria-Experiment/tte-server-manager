<template>
	<div :class="['bg-gray-3 rounded-xl overflow-hidden h-max w-full p-4 mb-4 sm:mb-8 terraria-bg']">
		<div class="title-bg-gradient"></div>
		<h1 class="font-main font-bold text-white-1 sm:text-teal-4 text-2xl relative z-20 sm:z-0">MANAGE GAME SERVER</h1>
		<p class="font-main font-bold text-gray-8 sm:text-gray-7 mt-2 relative z-20 sm:z-0">View and manage game server status</p>
	</div>

	<div 
		v-if="$checkPermissions(PERMISSIONS.instance.list) && !serverStore.isLoadingList && filteredInstanceOptions?.length"
		class="bg-gray-3 p-4 rounded-xl"
	>
		<p class="font-main font-bold text-gray-7 mb-2">HOST INSTANCE</p>
		<Dropdown 
			:options="filteredInstanceOptions"
			v-model="selectedInstance"
			inputClass="bg-teal-3 text-white-1"
			iconColor="text-white-1"
		/>

		<RefreshButton :loading="serverStore.somethingIsLoading" @input="refresh" :refresh-at="autoRefreshAt" />
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

	<MajorLoader v-else-if="serverStore.isLoadingList" text="Loading Instances..." />

	<BasicServerInfo 
		v-if="selectedInstance"
		:selected-server-data="selectedServerData"
		:selected-instance="selectedInstance"
		@autoRefreshAt="autoRefreshAt = $event"
	/>

	<SelectWorld 
		v-if="selectedInstance && !selectedServerData.state && !autoRefreshAt" 
		:selected-instance="selectedInstance" 
		:selected-server-data="selectedServerData" 
		@autoRefreshAt="autoRefreshAt = $event"
	/>

	<ServerConfig 
		v-if="selectedInstance"
		:selected-server-data="selectedServerData"
		:selected-instance="selectedInstance" 
	/>
</template>

<script>
import { useServerStore } from '../../stores/serverStore';
import { BTN_VARIANT } from '../../util/constants';
import { PERMISSIONS } from '../../util/permissionValues';
import Dropdown from '../common/Dropdown.vue';
import RefreshButton from '../common/RefreshButton.vue';
import BasicServerInfo from './tools/server/BasicServerInfo.vue';
import SelectWorld from './tools/server/SelectWorld.vue';
import MajorLoader from '../shared/MajorLoader.vue';
import ServerConfig from './tools/server/ServerConfig.vue';


export default {
	mixins: [],
	components: {
		Dropdown,
		RefreshButton,
		BasicServerInfo,
		SelectWorld,
		MajorLoader,
		ServerConfig,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			autoRefreshAt: null,
		}
	},
	computed: {		
		selectedServerData() {
			return {
				...(this.serverStore.serverStatusData[this.selectedInstance] || {}),
				state: Boolean(this.serverStore.serverStatusData[this.selectedInstance]?.status),
				players: this.serverStore.serverStatusData[this.selectedInstance]?.players,
				world: this.serverStore.serverStatusData[this.selectedInstance]?.world,
			}
		},
		filteredInstanceOptions() {
			return this.serverStore.instanceOptions.filter(i => this.$checkResourceAccess(`server::${i.id}`));
		},
		selectedInstance: {
			get() {
				return this.serverStore.selected.instance;
			},
			set(value) {
				this.serverStore.selected.instance = value;
			}
		}
	},
	methods: {
		refresh() {
			this.fetchServerStatus();
			this.fetchInstanceFiles(this.selectedInstance);
		},
		async fetchInstanceList() {
			this.$validatePermissions(PERMISSIONS.instance.list);

			try {
				const instances = await this.serverStore.fetchInstanceList();
				if (!this.selectedInstance) {
					instances.forEach(i => {
						if (this.$checkResourceAccess(`server::${i.id}`)) {
							this.selectedInstance = i.id;
						}
					});
				}
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
		
		async fetchServerStatus() {
			this.$validatePermissions(PERMISSIONS.server.status.read);

			if (!this.selectedInstance) return;

			try {
				await this.serverStore.fetchServerStatus(this.selectedInstance);
			} catch (e) {
				if (e.message.includes("Request timed out for")) {
					this.$alert.warning("Could not fetch server status: instance is not running or not responding");
				} else {
					this.$alert.error("Error getting server status");
					console.error(e);
				}
			}
		}
	},
	async mounted() {
		if (this.$checkPermissions(PERMISSIONS.instance.list)) {
			await this.fetchInstanceList();
			if (this.$checkPermissions(PERMISSIONS.instance.files.read) && this.$checkResourceAccess(`server::${this.selectedInstance}`)) {
				this.fetchInstanceFiles(this.selectedInstance);
			}
			if (this.$checkPermissions(PERMISSIONS.server.status.read) && this.$checkResourceAccess(`server::${this.selectedInstance}`)) {
				this.fetchServerStatus();
			}
		}
	},
	watch: {
		selectedInstance(value) {
			if (this.$checkResourceAccess(`server::${value}`)) {
				this.fetchServerStatus();
			}
			if (!this.serverStore.getInstanceData(value) && !this.serverStore.isLoadingStatus(value) && this.$checkPermissions(PERMISSIONS.instance.files.read)) {
				this.fetchInstanceFiles(this.selectedInstance);
			}
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";

.terraria-bg {
	background-image: url('/images/terraria-wallpaper.png');
	background-position: right center;
	background-repeat: no-repeat;
	@apply relative bg-size-[50%];
}

.terraria-bg .title-bg-gradient {
	@apply h-full w-1/2 bg-linear-to-l from-transparent to-gray-3 absolute right-0 top-0 z-10;
}
</style>
