<template>
	<div 
		v-if="$checkPermissions(PERMISSIONS.instance.list) && !serverStore.isLoadingList && serverStore.instanceOptions?.length"
		class="bg-gray-3 p-4 rounded-xl"
	>
		<p class="font-main font-bold text-gray-7 mb-2">HOST INSTANCE</p>
		<Dropdown 
			:options="serverStore.instanceOptions"
			v-model="selectedInstance"
			inputClass="bg-teal-3 text-white-1"
			iconColor="text-white-1"
		/>

		<RefreshButton :loading="serverStore.isLoadingStatus(selectedInstance)" @input="refresh" />
	</div>

	<MajorLoader v-else-if="serverStore.isLoadingList" text="Loading Instances..."/>

	<BasicServerInfo :selected-server-data="selectedServerData" />

	<SelectWorld :selected-instance="selectedInstance" :selected-server-data="selectedServerData" />

	<StatusTile 
		class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
		collapsible
		:perm-required="'SUPERPERM'"
	>
		<template #header>
			<Icon icon="rocket" color="text-gray-6" size="5" />
			<p class="text-gray-6 ml-2 text-lg">Create World</p>
		</template>
		<template #summary>
			<div class="flex items-center">
				<p class="text-2xl text-teal-4">6 worlds available</p>
				<Spinner v-if="false" class="h-6 w-6 text-teal-3 ml-2"/>
			</div>
		</template>
		<template #content>
			
		</template>
	</StatusTile>

	<Popup
		body-class="h-1/4 w-full sm:w-1/2 lg:w-1/4"
		header-text="CONFIRM"
		:buttons="[
			{ variant: BTN_VARIANT.PRIMARY, text: 'CANCEL', onClick: () => {} },
			{ variant: BTN_VARIANT.DANGER, text: 'STOP SERVER', onClick: () => {} },
		]"
	>
		<div class="p-4 h-full w-full flex text-center justify-center items-center font-main font-bold text-red-5">
			Are you sure you want to stop this server? There are currently 15 players online.
		</div>
	</Popup>
</template>

<script>
import { useServerStore } from '../../stores/serverStore';
import { BTN_VARIANT } from '../../util/constants';
import { PERMISSIONS } from '../../util/permissionValues';
import Dropdown from '../common/Dropdown.vue';
import RefreshButton from '../common/RefreshButton.vue';
import Popup from "../common/Popup.vue"
import BasicServerInfo from './tools/server/BasicServerInfo.vue';
import SelectWorld from './tools/server/SelectWorld.vue';
import MajorLoader from '../shared/MajorLoader.vue';


export default {
	mixins: [],
	components: {
		Dropdown,
		RefreshButton,
		Popup,
		BasicServerInfo,
		SelectWorld,
		MajorLoader,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			selectedInstance: null,
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
		
		async fetchServerStatus() {
			this.$validatePermissions(PERMISSIONS.server.status.read);

			try {
				await this.serverStore.fetchServerStatus(this.selectedInstance);
			} catch (e) {
				this.$alert.error("Error getting server status");
				console.error(e);
			}
		}
	},
	async mounted() {
		if (this.$checkPermissions(PERMISSIONS.instance.list)) {
			await this.fetchInstanceList();
			if (this.$checkPermissions(PERMISSIONS.instance.files.read)) {
				this.fetchInstanceFiles(this.selectedInstance);
			}
			if (this.$checkPermissions(PERMISSIONS.server.status.read)) {
				this.fetchServerStatus();
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
