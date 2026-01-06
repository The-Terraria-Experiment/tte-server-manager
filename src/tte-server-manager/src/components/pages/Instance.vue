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

		<RefreshButton :loading="serverStore.isLoadingStatus(selectedInstance)" @input="fetchInstanceStatus(selectedInstance)" />
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

	<StatusTile 
		:perm-required="[PERMISSIONS.instance.files.read, PERMISSIONS.instance.files.write]"
		collapsible
		class="mt-4 sm:mt-8"
	>
		<template #header>
			<Icon icon="folder-open" color="text-gray-6" size="5" />
			<p class="text-gray-6 ml-2 text-lg">Files</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">2 folders</p>
		</template>
		<template #content>
			<div class="flex flex-col sm:grid grid-cols-2 m-4">
				

				<div class="bg-gray-5 rounded-xl p-4 sm:mr-2 h-max">
					<div class="rounded-full flex items-center font-mono text-teal-4 bg-gray-1 px-4 py-1 grow">
						<p class="text-sm">/terraria/tshock/ServerPlugins/</p>
					</div>

					<FileHierarchy 
						class="mt-4 -ml-4"
						:files="[
							'plugin1/plugin1-runtime.dll',
							'plugin1/plugin1-config.json',
							'plugin1/resources/image.png',
							'plugin2/plugin2-config.json',
							'default-config.json'
						]"
						@deleteClicked="(data) => { }"
						@addClicked="(data) => {}"
					/>
				</div>

				<div class="bg-gray-5 rounded-xl p-4 sm:mr-2 h-max">
					<div class="rounded-full flex items-center font-mono text-teal-4 bg-gray-1 px-4 py-1 grow">
						<p class="text-sm">/terraria/worlds/</p>
					</div>

					<FileHierarchy 
						class="mt-4 -ml-4"
						:files="[
							'world1.zip',
							'world2.zip'
						]"
						@deleteClicked="(data) => { }"
						@addClicked="(data) => {}"
					/>
				</div>

			</div>
		</template>
	</StatusTile>
	
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
import { post } from '../../util/api';
import NotAllowed from '../common/NotAllowed.vue';
import RefreshButton from '../common/RefreshButton.vue';
import delay from '../../util/delay';
import { useServerStore } from '../../stores/serverStore';
import FileHierarchy from '../common/FileHierarchy.vue';

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
		FileHierarchy,
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
		async stopInstance() {
			this.$validatePermissions(PERMISSIONS.instance.status.stop);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstance).text;
				const response = await post(`/instance/${this.selectedInstance}/stop`, PERMISSIONS.instance.status.stop);
				await delay(2000);
				this.$alert.info(`Initiated shutdown of instance '${instanceName}'`);
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
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstance).text;
				const response = await post(`/instance/${this.selectedInstance}/start`, PERMISSIONS.instance.status.start);
				await delay(2000);
				this.$alert.info(`Initiated startup of instance '${instanceName}'`);
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
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstance).text;
				const response = await post(`/instance/${this.selectedInstance}/restart`, PERMISSIONS.instance.status.restart);
				await delay(2000);
				this.$alert.info(`Initiated restart of instance '${instanceName}'`);
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
			if (!this.serverStore.getInstanceData(value) && !this.serverStore.isLoadingStatus(value)) {
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
}

.gradient-tile-red {
	@apply bg-linear-to-b from-gray-3 to-red-900 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
}
</style>
