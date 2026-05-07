<template>
	<div class="flex flex-col sm:grid sm:grid-cols-4">
		<ServerState />

		<Players />

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			collapsible
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="circle-info" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Server Info</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">7 entries</p>
			</template>
			<template #content>
				<div class="grid info-grid font-mono m-4 bg-gray-4 rounded-lg text-white-0">
					<div class="px-2 py-1">Active World</div>
					<div class="px-2 py-1">{{ selectedServerData.world ?? "Unknown" }}</div>

					<div class="bg-gray-5 px-2 py-1">Terraria Version</div>
					<div class="bg-gray-5 px-2 py-1">{{ selectedServerData.serverversion ?? "Unknown" }}</div>

					<div class="px-2 py-1">TShock Version</div>
					<div class="px-2 py-1">{{ selectedServerData.tshockversion ?? "Unknown" }}</div>

					<div class="bg-gray-5 px-2 py-1">Port</div>
					<div class="bg-gray-5 px-2 py-1">{{ selectedServerData.port ?? "Unknown" }}</div>

					<div class="px-2 py-1">Max Players</div>
					<div class="px-2 py-1">{{ selectedServerData.maxplayers ?? "Unknown" }}</div>

					<div class="bg-gray-5 px-2 py-1">Uptime</div>
					<div class="bg-gray-5 px-2 py-1">{{ selectedServerData.uptime ?? "Unknown" }}</div>

					<div class="px-2 py-1">Password</div>
					<div class="px-2 py-1">{{ selectedServerData.serverpassword ?? "Unknown" }}</div>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:collapsible="!!ruleEntryCount"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="scroll" color="text-gray-6" size="5" />
				<p class="text-gray-6 ml-2 text-lg">Rules</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ ruleEntryCount }} entries</p>
			</template>
			<template #content>
				<div v-if="ruleEntryCount" class="grid info-grid font-mono m-4 bg-gray-4 rounded-lg text-white-0">
					<template v-for="(value, rule, i) in selectedServerData.rules">
						<div :class="['px-2 py-1', {'bg-gray-5': i%2}]">{{ rule }}</div>
						<div :class="['px-2 py-1', {'bg-gray-5': i%2}]">{{ value }}</div>
					</template>
				</div>
			</template>
		</StatusTile>
	</div>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Checkbox from '../../../common/Checkbox.vue';
import DateTimePickerPopup from '../../../common/DateTimePickerPopup.vue';
import Icon from '../../../common/Icon.vue';
import Popup from "../../../common/Popup.vue";
import ServerState from './basic/ServerState.vue';
import Players from './basic/Players.vue';

export default {
	mixins: [],
	components: {
		Popup,
		DateTimePickerPopup,
		Checkbox,
		ServerState,
		Players,
	},
	emits: ['autoRefreshAt', "refresh"],
	props: {
		
	},
	data() {
		return {
			BTN_VARIANT,
			PERMISSIONS,
			serverStore: useServerStore(),
		}
	},
	computed: {
		selectedServerData() {
			return this.serverStore.selectedServerData;
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		ruleEntryCount() {
			return Object.keys(this.selectedServerData.rules || {}).length;
		}
	},
	methods: {

	},
}
</script>

<style scoped>
.info-grid {
	grid-template-columns: 1fr auto;
}
</style>
