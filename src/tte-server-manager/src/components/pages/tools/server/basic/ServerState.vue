<template>
	<div>
		<StatusTile
			:class="['grow gradient-tile', selectedServerData.state ? 'gradient-tile-green' : 'gradient-tile-red']"
			:collapsible="selectedServerData.state && showStopButton"
			:perm-required="PERMISSIONS.server.status.read"
			:floatingExpand="!isMobile"
			:loading="statusLoading || statusStore.isTaskRunning(TASK_IDS.SERVER_STATUS_CHECK)"
		>
			<template #header>
				<Icon icon="power" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Server Status</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4"> {{ currentServerState }} </p>
			</template>
			<template #content>
				<div v-if="selectedServerData.state">
					<FlexButton
						v-if="$checkPermissions(PERMISSIONS.server.status.stop) && showStopButton"
						class="mx-4 mb-4 mt-4"
						:variant="BTN_VARIANT.DANGER"
						@input="openConfirmStopPopup"
					>
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>
		
		<Popup
			body-class="h-1/4 w-11/12 sm:w-1/2 lg:w-1/4"
			header-text="CONFIRM"
			:open="confirmStopPopupOpen"
			@x-clicked="confirmStopPopupOpen = false"
			:buttons="[
				{ variant: BTN_VARIANT.PRIMARY, text: 'CANCEL', onClick: () => { confirmStopPopupOpen = false } },
				{ variant: BTN_VARIANT.DANGER, text: 'STOP SERVER', onClick: stopServer },
			]"
		>
			<div class="p-4 h-full w-full flex text-center justify-center items-center font-main font-bold text-red-5">
				Are you sure you want to stop this server? There are currently {{ this.selectedServerData.playercount }} players online.
			</div>
		</Popup>
	</div>
</template>

<script>
import { useServerStore } from '../../../../../stores/serverStore';
import { TASK_IDS } from '../../../../../stores/statusStore';
import { useStatusStore } from '../../../../../stores/statusStore';
import { post } from '../../../../../util/api';
import { BTN_VARIANT, WORLD_STATES } from '../../../../../util/constants';
import { PERMISSIONS } from '../../../../../util/permissionValues';
import { getDateOffset } from '../../../../../util/timeutils';
import Popup from '../../../../common/Popup.vue';


export default {
	mixins: [],
	components: {
		Popup,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			TASK_IDS,
			serverStore: useServerStore(),
			statusStore: useStatusStore(),
			confirmStopPopupOpen: false,
			statusLoading: false,
			showStopButton: true,
		}
	},
	computed: {
		selectedServerData() {
			return this.serverStore.selectedServerData;
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		currentServerState() {
			return this.serverStore.worldStatusData[this.selectedInstance] ?? WORLD_STATES.UNKNOWN;
		}
	},
	methods: {
		openConfirmStopPopup() {
			if (this.selectedServerData.playercount && this.selectedServerData.playercount > 0) {
				this.confirmStopPopupOpen = true;
			} else {
				this.stopServer();
			}
		},

		async stopServer() {
			this.confirmStopPopupOpen = false;
			this.$validatePermissions(PERMISSIONS.server.status.stop);

			if (this.statusLoading) return;
			this.statusLoading = true;

			try {
				const response = await post(`/server/${this.selectedInstance}/stop`, PERMISSIONS.server.status.stop);

				this.showStopButton = false;
				this.serverStore.worldStatusData[this.selectedInstance] = WORLD_STATES.STOPPING;

				this.statusStore.subscribeToTaskEnd(TASK_IDS.SERVER_STATUS_CHECK, () => {
					this.showStopButton = true;
				});
				this.statusStore.startRepeatingTask(TASK_IDS.SERVER_STATUS_CHECK, () => !this.selectedServerData.state);

				this.$alert.success("Server stopping");
			} catch (e) {
				this.$alert.error("Error stopping server");
				console.error(e);
			} finally {
				this.statusLoading = false;
			}
		},
	},
}
</script>

<style scoped>

</style>
