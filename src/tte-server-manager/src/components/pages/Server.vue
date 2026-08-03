<template>
	<div class="sm:grid sm:grid-cols-2 gap-2">
		<div :class="['bg-gray-1 rounded-xl overflow-hidden h-full w-full p-4 mb-4 sm:mb-8 flex flex-col items-center justify-center']">
			<!-- <div class="title-bg-gradient"></div> -->
			<div class="flex items-center">
				<Icon icon="gamepad" size="8" color="text-white-1 sm:text-teal-4" />
				<h1 class="font-main font-bold text-white-1 sm:text-teal-4 text-2xl relative z-20 sm:z-0 ml-3">MANAGE GAME SERVER</h1>
			</div>
			<p class="font-main font-bold text-gray-8 sm:text-gray-7 mt-2 relative z-20 sm:z-0">View and manage game server status</p>
		</div>
		<div
			v-if="$checkPermissions(PERMISSIONS.instance.list) && !serverStore.isLoadingList && filteredInstanceOptions?.length"
			class="bg-gray-1 p-4 rounded-xl"
		>
			<p class="font-main font-bold text-gray-7 mb-2">PICK HOST INSTANCE</p>
			<Dropdown
				:options="filteredInstanceOptions"
				v-model="selectedInstance"
				inputClass="bg-teal-3 text-white-1"
				iconColor="text-white-1"
			/>
			<div class="flex flex-col sm:flex-row gap-4 mt-4">
				<RefreshButton
					:loading="serverStore.somethingIsLoading"
					@input="refresh"
				/>
				<FlexButton
					v-if="$checkPermissions(PERMISSIONS.system.dropcache)"
					:variant="BTN_VARIANT.SECONDARY"
					leftIcon="ban"
					leftIconSize="5"
					@input="dropTshockTokenCache"
				>
					DROP TOKEN CACHE
				</FlexButton>
			</div>
		</div>

		<div v-else class="bg-gray-1 rounded-xl"></div>
	</div>


	<StatusTile 
		v-if="!$checkPermissions(PERMISSIONS.instance.list) && !serverStore.isLoadingList && !filteredInstanceOptions.length"
		class="mt-4"
	>
		<template #header>
			<Icon icon="warning" color="text-yellow-2" size="4" />
			<p class="text-yellow-2 ml-2 text-lg">No Data</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">No instances to show</p>
		</template>
	</StatusTile>

	<MajorLoader 
		v-else-if="serverStore.isLoadingList" 
		class="mt-4"
		text="Loading Instances..." 
	/>

	<BasicServerInfo 
		v-if="selectedInstance"
	/>

	<SelectWorld 
		v-if="selectWorldAllowed"
	/>

	<CreateWorld 
		v-if="createWorldAllowed"
		ref="createWorld"
		@refresh="refresh"
	/>

	<BrowseLogs />

	<TShockConsoleLogs />

	<ServerConfig
		v-if="selectedInstance && selectedInstanceData?.online"
	/>

	<RunTshockCommand
		v-if="serverIsOnline"
	/>
</template>

<script>
import { useServerStore } from '../../stores/serverStore';
import { BTN_VARIANT, WORLD_STATES } from '../../util/constants';
import { PERMISSIONS } from '../../util/permissionValues';
import Dropdown from '../common/Dropdown.vue';
import RefreshButton from '../common/RefreshButton.vue';
import BasicServerInfo from './tools/server/BasicServerInfo.vue';
import SelectWorld from './tools/server/SelectWorld.vue';
import MajorLoader from '../shared/MajorLoader.vue';
import FlexButton from '../common/FlexButton.vue';
import { get, post } from '../../util/api';
import CreateWorld from './tools/server/CreateWorld.vue';
import ManageBans from './tools/server/ManageBans.vue';
import ServerConfig from './tools/server/ServerConfig.vue';
import { useStatusStore } from '../../stores/statusStore';
import { TASK_IDS } from '../../stores/statusStore';
import BrowseLogs from './tools/server/BrowseLogs.vue';
import TShockConsoleLogs from './tools/server/TShockConsoleLogs.vue';
import RunTshockCommand from './tools/server/RunTshockCommand.vue';

// Stable across remounts, so a re-registered handler replaces its predecessor instead of stacking.
const STATUS_HANDLER_ID = "server-page-fetch-status";


export default {
	mixins: [],
	components: {
		Dropdown,
		RefreshButton,
		BasicServerInfo,
		SelectWorld,
		MajorLoader,
		CreateWorld,
		ManageBans,
		ServerConfig,
		BrowseLogs,
		TShockConsoleLogs,
		RunTshockCommand,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			statusStore: useStatusStore(),
		}
	},
	computed: {
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
		},
		selectedServerData() {
			return this.serverStore.selectedServerData;
		},
		selectedInstanceData() {
			return this.serverStore.selectedInstanceData;
		},
		selectWorldAllowed() {
			return this.selectedInstance && !this.selectedServerData.state && this.serverStore.worldStatusData[this.selectedInstance] === WORLD_STATES.OFFLINE;
		},
		createWorldAllowed() {
			return this.selectedInstance && !this.selectedServerData.state;
		},
		serverIsOnline() {
			return this.selectedInstance && this.selectedServerData.state && this.selectedInstanceData?.online;
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
			// The world list is sourced from this fetch, so viewing worlds
			// (server.world.list) is sufficient even without instance.files.read.
			this.$validatePermissions([PERMISSIONS.server.world.list, PERMISSIONS.instance.files.read], false);

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
		},

		async fetchWorldCreationStatus() {
			try {
				const status = await get(`/server/${this.selectedInstance}/world/create/alljobs/status`, PERMISSIONS.server.world.create);

				// Only pick up a job that's actually still going. A finished — or abandoned — row
				// sticks around until someone starts the next creation, and attaching the poller to
				// it would replay its outcome as a fresh alert on every page load.
				if (status && status.found !== false && !status.isDone) {
					this.serverStore.worldStatusData[this.selectedInstance] = WORLD_STATES.CREATING;
					this.$refs.createWorld.startWorldCreatePolling(status);
				}
			} catch (e) {
				this.$alert.error("Error checking world creation status");
				console.error(e);
			}
		},

		async dropTshockTokenCache() {
			this.$validatePermissions(PERMISSIONS.system.dropcache);

			try {
				await post("/server/dropcache", PERMISSIONS.system.dropcache);
				this.$alert.success("TShock token cache dropped");
			} catch (e) {
				this.$alert.error("Error dropping token cache");
				console.error(e);
			}
		}
	},
	async created() {
		if (this.$checkPermissions(PERMISSIONS.instance.list)) {
			await this.fetchInstanceList();
			if (this.$checkPermissions([PERMISSIONS.server.world.list, PERMISSIONS.instance.files.read], false) && this.$checkResourceAccess(`server::${this.selectedInstance}`)) {
				this.fetchInstanceFiles(this.selectedInstance);
			}
			if (this.$checkPermissions(PERMISSIONS.server.status.read) && this.$checkResourceAccess(`server::${this.selectedInstance}`)) {
				await this.fetchServerStatus();
				this.fetchWorldCreationStatus();
			}
		}

		this.statusStore.subscribeToTask(TASK_IDS.SERVER_STATUS_CHECK, this.fetchServerStatus, STATUS_HANDLER_ID);
	},
	beforeUnmount() {
		this.statusStore.unsubscribeFromTask(TASK_IDS.SERVER_STATUS_CHECK, STATUS_HANDLER_ID);
	},
	watch: {
		selectedInstance(value) {
			if (this.$checkResourceAccess(`server::${value}`)) {
				const doFetches = async () => {
					await this.fetchServerStatus();
					this.fetchWorldCreationStatus();
				};
				doFetches();
			}
			if (!this.serverStore.getInstanceData(value) && !this.serverStore.isLoadingStatus(value) && this.$checkPermissions([PERMISSIONS.server.world.list, PERMISSIONS.instance.files.read], false)) {
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
