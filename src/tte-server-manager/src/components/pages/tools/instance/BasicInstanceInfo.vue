<template>
	<div class="flex flex-col sm:grid sm:grid-cols-4 mt-2 sm:mt-6">
		<StatusTile 
			:class="['grow mt-2 sm:mr-1', selectedInstanceData.state === 'ONLINE' ? 'gradient-tile-green' : 'gradient-tile-red']" 
			:collapsible="['ONLINE', 'OFFLINE'].includes(selectedInstanceData.state)"
			:perm-required="PERMISSIONS.instance.status.read"
			display-if-not-allowed
		>
			<template #header>
				<Icon icon="power" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Instance Status</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">{{ selectedInstanceData.state }}</p>
					<Spinner v-if="loading.stateChange || statusStore.isTaskRunning(TASK_IDS.INSTANCE_STATUS_CHECK)" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
			<template #content>
				<div v-if="selectedInstanceData.state === 'ONLINE'">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.instance.status.stop) && !loading.stateChange && showStateChangeButtons"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.DANGER"
						@input="openConfirmStopPopup"
					>
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.instance.status.restart) && !loading.stateChange && showStateChangeButtons"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.DANGER"
						@input="openConfirmRestartPopup"
					>
						<p class="py-2 px-12">RESTART</p>
					</FlexButton>
				</div>
				<div v-if="selectedInstanceData.state === 'OFFLINE'">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.instance.status.start) && !loading.stateChange && showStateChangeButtons"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.PRIMARY"
						@input="startInstance"
					>
						<p class="py-2 px-12">START</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-2 sm:mx-1 gradient-tile"
			:perm-required="PERMISSIONS.instance.status.read"
		>
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

		<StatusTile 
			class="grow mt-2 sm:mx-1 gradient-tile"
			:perm-required="PERMISSIONS.instance.status.read"
		>
			<template #header>
				<Icon icon="network" color="text-gray-6" size="5" />
				<p class="text-gray-6 ml-2 text-lg">IP Address</p>
			</template>
			<template #summary>
				<p v-if="selectedInstanceData.publicIp" class="text-2xl text-teal-4">{{ selectedInstanceData.publicIp }}</p>
				<p v-else class="text-2xl text-teal-4">Unknown</p>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-2 sm:ml-1 gradient-tile"
			:perm-required="PERMISSIONS.instance.status.read"
		>
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

	<Popup
		body-class="h-1/3 w-11/12 sm:w-1/2 lg:w-1/4"
		header-text="CONFIRM"
		:open="confirmStopPopupOpen"
		@x-clicked="confirmStopPopupOpen = false"
		:buttons="[
			{ variant: BTN_VARIANT.PRIMARY, text: 'CANCEL', onClick: () => { confirmStopPopupOpen = false } },
			{ variant: BTN_VARIANT.DANGER, text: 'STOP INSTANCE', onClick: stopInstance },
		]"
	>
		<div class="p-4 h-full w-full flex flex-col text-center justify-center items-center font-main font-bold">
			<p class="text-white-0 py-2">Are you sure you want to stop this instance?</p>
			<p class="text-red-5">If there is a server currently running on this instance, any unsaved progress will be lost!</p>
		</div>
	</Popup>

	<Popup
		body-class="h-1/3 w-11/12 sm:w-1/2 lg:w-1/4"
		header-text="CONFIRM"
		:open="confirmRestartPopupOpen"
		@x-clicked="confirmRestartPopupOpen = false"
		:buttons="[
			{ variant: BTN_VARIANT.PRIMARY, text: 'CANCEL', onClick: () => { confirmRestartPopupOpen = false } },
			{ variant: BTN_VARIANT.DANGER, text: 'RESTART INSTANCE', onClick: restartInstance },
		]"
	>
		<div class="p-4 h-full w-full flex flex-col text-center justify-center items-center font-main font-bold">
			<p class="text-white-0 py-2">Are you sure you want to restart this instance?</p>
			<p class="text-red-5">If there is a server currently running on this instance, any unsaved progress will be lost!</p>
		</div>
	</Popup>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { TASK_IDS } from '../../../../stores/statusStore';
import { useStatusStore } from '../../../../stores/statusStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT, INSTANCE_STATES } from '../../../../util/constants';
import delay from '../../../../util/delay';
import { PERMISSIONS } from '../../../../util/permissionValues';
import { getDateOffset } from '../../../../util/timeutils';
import ActiveDate from '../../../common/ActiveDate.vue';
import Popup from '../../../common/Popup.vue';


export default {
	mixins: [],
	components: {
		ActiveDate,
		Popup,
	},
	emits: [],
	props: {
		selectedInstanceData: {
			type: Object,
			required: true
		},
		loading: {
			type: Object,
			required: true,
		}
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			statusStore: useStatusStore(),
			TASK_IDS,
			statusPollInterval: null,
			confirmStopPopupOpen: false,
			confirmRestartPopupOpen: false,
			showStateChangeButtons: true,
		}
	},
	computed: {
		
	},
	methods: {
		openConfirmStopPopup() {
			this.confirmStopPopupOpen = true;
		},
		openConfirmRestartPopup() {
			this.confirmRestartPopupOpen = true;
		},
		async stopInstance() {
			this.confirmStopPopupOpen = false;
			this.$validatePermissions(PERMISSIONS.instance.status.stop);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstanceData.id).text;
				const response = await post(`/instance/${this.selectedInstanceData.id}/stop`, PERMISSIONS.instance.status.stop);
				await delay(2000);
				this.$alert.success(`Initiated shutdown of instance '${instanceName}'`);
				this.pollInstanceState([INSTANCE_STATES.ONLINE, INSTANCE_STATES.OFFLINE]);
				this.fetchInstanceStatus(this.selectedInstanceData.id);
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
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstanceData.id).text;
				const response = await post(`/instance/${this.selectedInstanceData.id}/start`, PERMISSIONS.instance.status.start);
				await delay(2000);
				this.$alert.success(`Initiated startup of instance '${instanceName}'`);
				this.pollInstanceState([INSTANCE_STATES.ONLINE, INSTANCE_STATES.OFFLINE]);
				this.fetchInstanceStatus(this.selectedInstanceData.id);
			} catch (e) {
				this.$alert.error("Error initiating instance startup");
				console.error(e);
			} finally {
				this.loading.stateChange = false;
			}
		},
		async restartInstance() {
			this.confirmRestartPopupOpen = false;
			this.$validatePermissions(PERMISSIONS.instance.status.restart);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstanceData.id).text;
				const response = await post(`/instance/${this.selectedInstanceData.id}/restart`, PERMISSIONS.instance.status.restart);
				await delay(2000);
				this.$alert.success(`Initiated restart of instance '${instanceName}'`);
				this.fetchInstanceStatus(this.selectedInstanceData.id);
			} catch (e) {
				this.$alert.error("Error initiating instance restart");
				console.error(e);
			} finally {
				this.loading.stateChange = false;
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

		pollInstanceState(stopStates) {
			this.showStateChangeButtons = false;

			this.statusStore.startRepeatingTask(TASK_IDS.INSTANCE_STATUS_CHECK, () => {
				return stopStates.includes(this.selectedInstanceData.state)
			});

			this.statusStore.subscribeToTaskEnd(TASK_IDS.INSTANCE_STATUS_CHECK, () => {
				this.showStateChangeButtons = true;
			});
		},
	}
}
</script>

<style scoped>

</style>
