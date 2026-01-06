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

		<RefreshButton :loading="serverStore.isLoadingStatus(selectedInstance)" @input="fetchInstanceStatus(selectedInstance)" />
	</div>

	<div class="flex flex-col sm:grid sm:grid-cols-3">
		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			collapsible
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="power" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Server Status</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">RUNNING</p>
					<Spinner v-if="false" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
			<template #content>
				<div v-if="true">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.server.status.stop)"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.DANGER"
						@input=""
					>
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
				</div>
				<div v-if="true">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.server.status.start)"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.PRIMARY"
						@input=""
					>
						<p class="py-2 px-12">START</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			collapsible
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="people-group" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Players Online</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">15</p>
					<Spinner v-if="false" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
			<template #content>
				<div class="font-main font-semibold px-2 pb-2 text-teal-6 flex w-full flex-wrap">
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">havoc</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">exception</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">havoc</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">exception</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">havoc</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">exception</div>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="earth" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Active World</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">worldfile</p>
					<Spinner v-if="false" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
		</StatusTile>
	</div>

	<div class="flex flex-col sm:grid">
		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			collapsible
			:perm-required="PERMISSIONS.server.world.select"
		>
			<template #header>
				<Icon icon="rocket" color="text-gray-6" size="5" />
				<p class="text-gray-6 ml-2 text-lg">Launch World</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">6 worlds available</p>
					<Spinner v-if="false" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
			<template #content>
				<p class="font-main font-bold text-gray-7 px-5">SELECT WORLD</p>
				<div class="mx-4 mt-1 mb-4 bg-gray-5 rounded-lg">
					<div class="grid world-select-grid px-2 py-2">
						<div></div>
						<div class="font-main font-semibold text-teal-6 pb-2">World File Name</div>
						<div class="font-main font-semibold text-teal-6">File Size</div>
						
						<template v-for="(world, idx) in serverStore.servers">
							<div :class="['p-2 rounded-l', { 'bg-gray-4': !(idx%2)}]">
								<Checkbox class="h-4 w-4" />
							</div>
							<div :class="['flex items-center', { 'bg-gray-4': !(idx%2)}]">
								<p class="font-mono text-white-0 font-semibold">{{ world.name }}</p>
							</div>
							<div :class="['flex items-center rounded-r pr-2', { 'bg-gray-4': !(idx%2)}]">
								<p class="font-mono text-white-0 font-semibold">{{ formatFileSize(world.size) }}</p>
							</div>
						</template>
					</div>
				</div>

				<p class="font-main font-bold text-gray-7 px-5">WORLD OPTIONS</p>
				<div class="mx-4 mb-4 mt-1 rounded-lg flex flex-col sm:grid grid-cols-3">
					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">Port</p>
						<ValueInput
							type="number"
							max="9999"
							min="1000"
							placeholder="Value between 1000 and 9999"
						/>
					</div>

					<div class="bg-gray-5 rounded-lg p-4 my-4 sm:my-0 sm:mx-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">Max Players</p>
						<ValueInput
							type="number"
							max="500"
							min="1"
							placeholder="Value between 1 and 500"
						/>
					</div>

					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">Password</p>
						<ValueInput
							maxlength="25"
							placeholder="Leave blank for none"
						/>
					</div>
				</div>

				<div class="flex justify-end p-4">
					<FlexButton 
						:variant="BTN_VARIANT.PRIMARY"
					>
						<p class="font-main font-bold py-2 px-4 md:px-10">START SERVER</p>
					</FlexButton>
				</div>
				
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			collapsible
			:perm-required="PERMISSIONS.server.world.select"
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
	</div>

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
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import RefreshButton from '../common/RefreshButton.vue';
import Spinner from '../common/Spinner.vue';
import StatusTile from '../common/StatusTile.vue';
import Popup from "../common/Popup.vue"
import Checkbox from "../common/Checkbox.vue";
import { formatFileSize } from "../../util/format"
import ValueInput from "../common/ValueInput.vue"


export default {
	mixins: [],
	components: {
		Dropdown,
		RefreshButton,
		StatusTile,
		Icon,
		Spinner,
		FlexButton,
		Popup,
		Checkbox,
		ValueInput,
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
		formatFileSize,
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
.world-select-grid {
	grid-template-columns: auto 1fr auto;
}
</style>
