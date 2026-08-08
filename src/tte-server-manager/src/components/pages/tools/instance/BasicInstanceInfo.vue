<template>
	<div class="flex flex-col sm:grid sm:grid-cols-2 2xl:grid-cols-4 mt-6 gap-2">
		<StatusTile 
			:class="['grow', selectedInstanceData.state === 'ONLINE' ? 'gradient-tile-green' : 'gradient-tile-red']" 
			:collapsible="showStatusOptions"
			:contentLoaded="showStatusOptions"
			:perm-required="PERMISSIONS.instance.status.read"
			:floatingExpand="!isMobile"
			display-if-not-allowed
		>
			<template #header>
				<Icon icon="power" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Instance Status</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">{{ displayState }}</p>
					<Spinner v-if="showSpinner" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
			<template #content>
				<p v-if="isShuttingDown" class="text-sm text-gray-8 mx-4 mb-4 font-mono">{{ shutdownStepLabel }}</p>
				<div v-if="selectedInstanceData.state === 'ONLINE'">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.instance.status.stop)"
						class="mx-4 mb-4" 
						:disabled="loading.stateChange || isShuttingDown || !showStateChangeButtons"
						:variant="BTN_VARIANT.DANGER"
						@input="openConfirmStopPopup"
					>
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.instance.status.restart)"
						class="mx-4 mb-4" 
						:disabled="loading.stateChange || isShuttingDown || !showStateChangeButtons"
						:variant="BTN_VARIANT.DANGER"
						@input="openConfirmRestartPopup"
					>
						<p class="py-2 px-12">RESTART</p>
					</FlexButton>
				</div>
				<div v-if="selectedInstanceData.state === 'OFFLINE'">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.instance.status.start)"
						class="mx-4 mb-4" 
						:disabled="loading.stateChange || isShuttingDown || !showStateChangeButtons"
						:variant="BTN_VARIANT.PRIMARY"
						@input="startInstance"
					>
						<p class="py-2 px-12">START</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow gradient-tile"
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
			class="grow gradient-tile"
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
			class="grow gradient-tile"
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
			<p class="text-red-5">The shutdown pipeline will be skipped, and any running processes will be force-terminated.</p>
		</div>
	</Popup>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { TASK_IDS } from '../../../../stores/statusStore';
import { shutdownTaskId, useStatusStore } from '../../../../stores/statusStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT, INSTANCE_STATES } from '../../../../util/constants';
import delay from '../../../../util/delay';
import { PERMISSIONS } from '../../../../util/permissionValues';
import { getDateOffset } from '../../../../util/timeutils';
import ActiveDate from '../../../common/ActiveDate.vue';
import Popup from '../../../common/Popup.vue';

// EC2 states that resolve on their own, without anyone asking for another change.
const TRANSITIONAL_STATES = [
	INSTANCE_STATES.STARTING,
	INSTANCE_STATES.STOPPING,
	INSTANCE_STATES.SHUTTING_DOWN,
];

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
		showStatusOptions() {
			return ['ONLINE', 'OFFLINE'].includes(this.selectedInstanceData.state) &&
				this.$checkPermissions([PERMISSIONS.instance.status.stop, PERMISSIONS.instance.status.restart], false);
		},
		isShuttingDown() {
			return Boolean(this.selectedInstanceData.shutdown?.active);
		},
		/**
		 * Every reason the state is mid-change, in one place — because the individual signals hand off
		 * to each other rather than overlapping, and checking only some of them leaves gaps.
		 *
		 * The one that bit: `shutdown.active` drops as soon as the worker issues the EC2 stop, but the
		 * box then sits in STOPPING for another minute, and the poller still watching it is the store's
		 * per-instance shutdown task — not INSTANCE_STATUS_CHECK, which `stopInstance` never starts. So
		 * at exactly that moment all of the old conditions went false together and the spinner vanished
		 * while the instance was visibly still stopping. The transitional EC2 states are the backstop:
		 * they hold regardless of which poller (if any) happens to own the instance at the time.
		 */
		showSpinner() {
			return this.loading.stateChange ||
				this.isShuttingDown ||
				TRANSITIONAL_STATES.includes(this.selectedInstanceData.state) ||
				this.statusStore.isTaskRunning(TASK_IDS.INSTANCE_STATUS_CHECK) ||
				this.statusStore.isTaskRunning(shutdownTaskId(this.selectedInstanceData.id));
		},
		/**
		 * The EC2 state still reads ONLINE for most of a shutdown — the box isn't asked to stop until
		 * the archive and sync tasks are done — so it can't be shown as-is without looking like
		 * nothing happened when STOP was pressed.
		 */
		displayState() {
			return this.isShuttingDown ? INSTANCE_STATES.SHUTTING_DOWN : this.selectedInstanceData.state;
		},
		shutdownStepLabel() {
			const shutdown = this.selectedInstanceData.shutdown;
			if (!shutdown) return "";

			const labels = {
				"queued": "Queued",
				"stopping-server": "Stopping game server",
				"archiving-logs": "Archiving console logs",
				"syncing-files": "Syncing instance files",
				"stopping-instance": "Stopping instance",
				"completed": "Shutdown complete",
			};

			// Falls back to the step's own label from the backend, so a task added to the registry
			// still reads sensibly here before this map catches up.
			return labels[shutdown.step] || shutdown.detail || "Shutting down";
		}
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

				// No job is queued when the instance was already on its way down, so there is nothing
				// to track — seeding one anyway would leave the tile claiming a shutdown that no
				// worker is running.
				if (response?.alreadyStopped) {
					this.$alert.info(`Instance '${instanceName}' is already stopping`);
				} else {
					this.$alert.success(`Initiated shutdown of instance '${instanceName}'`);

					// The stop only queues a job now — the archive, sync and EC2 stop run on a worker
					// that outlives this request. The store owns the polling from here so it survives
					// leaving this page, and reports how it ended.
					this.serverStore.markShutdownQueued(this.selectedInstanceData.id, response?.jobID);
				}

				this.fetchInstanceStatus(this.selectedInstanceData.id);
			} catch (e) {
				this.$alert.error(e?.message || "Error initiating instance shutdown");
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
				// ONLINE only. Listing OFFLINE too made this a no-op: the stop condition is evaluated
				// before the first tick, and the instance is of course still OFFLINE at that point, so
				// the poller cancelled itself immediately every time.
				this.pollInstanceState([INSTANCE_STATES.ONLINE]);
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
				this.pollInstanceState([INSTANCE_STATES.ONLINE]);
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
			}, "basic-instance-info-show-state-buttons");
		},
	}
}
</script>

<style scoped>

</style>
