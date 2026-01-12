<template>
	<div class="flex flex-col sm:grid sm:grid-cols-4">
		<StatusTile 
			:class="['grow mt-4 sm:mt-8 sm:mr-1', selectedInstanceData.state === 'ONLINE' ? 'gradient-tile-green' : 'gradient-tile-red']" 
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

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
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
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
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
			class="grow mt-4 sm:mt-8 sm:ml-1 gradient-tile"
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
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT, INSTANCE_STATES } from '../../../../util/constants';
import delay from '../../../../util/delay';
import { PERMISSIONS } from '../../../../util/permissionValues';
import { getDateOffset } from '../../../../util/timeutils';
import ActiveDate from '../../../common/ActiveDate.vue';


export default {
	mixins: [],
	components: {
		ActiveDate,
	},
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
			statusPollInterval: null,
			statusPollStopStates: []
		}
	},
	computed: {
		
	},
	methods: {
		async stopInstance() {
			this.$validatePermissions(PERMISSIONS.instance.status.stop);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstanceData.id).text;
				const response = await post(`/instance/${this.selectedInstanceData.id}/stop`, PERMISSIONS.instance.status.stop);
				await delay(2000);
				this.$alert.info(`Initiated shutdown of instance '${instanceName}'`);
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
				this.$alert.info(`Initiated startup of instance '${instanceName}'`);
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
			this.$validatePermissions(PERMISSIONS.instance.status.restart);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstanceData.id).text;
				const response = await post(`/instance/${this.selectedInstanceData.id}/restart`, PERMISSIONS.instance.status.restart);
				await delay(2000);
				this.$alert.info(`Initiated restart of instance '${instanceName}'`);
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
			this.statusPollStopStates = stopStates;
			const refreshAt = getDateOffset(5000).valueOf();
			this.$emit("autoRefreshAt", refreshAt);

			this.statusPollInterval = setInterval(() => {
				const refreshAt = getDateOffset(5000).valueOf();
				this.$emit("autoRefreshAt", refreshAt);
			}, 6000);
		},

		checkForPollStop() {
			if (this.statusPollStopStates.includes(this.selectedInstanceData.state)) {
				this.statusPollStopStates = [];
				clearInterval(this.statusPollInterval);
				this.$emit("autoRefreshAt", null);
			}
		}
	},
	watch: {
		"selectedInstanceData.state": function () {
			this.checkForPollStop();
		}
	}
}
</script>

<style scoped>

</style>
