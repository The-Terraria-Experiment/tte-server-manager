<template>
	<StatusTile 
		class="grow sm:mt-2 gradient-tile"
		:collapsible="selectedServerData.state"
		:floatingExpand="!isMobile"
		:perm-required="PERMISSIONS.server.status.read"
	>
		<template #header>
			<Icon icon="circle-info" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Server Info</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4 truncate w-full">{{ selectedServerData.state ? selectedServerData.world : 'Unknown'}}</p>
		</template>
		<template #content v-if="selectedServerData.state">
			<div class="max-h-100 overflow-y-auto">
				<p class="font-main font-bold text-gray-7 px-5">SERVER INFO</p>
				<div class="grid info-grid font-mono m-4 bg-gray-4 rounded-lg text-white-0">
					<div class="px-2 py-1">Active World</div>
					<div class="px-2 py-1">{{ selectedServerData.world ?? "Unknown" }}</div>
					<div class="bg-gray-5 px-2 py-1">Terraria Version</div>
					<div class="bg-gray-5 px-2 py-1 text-right">{{ selectedServerData.serverversion ?? "Unknown" }}</div>
					<div class="px-2 py-1">TShock Version</div>
					<div class="px-2 py-1 text-right">{{ selectedServerData.tshockversion ?? "Unknown" }}</div>
					<div class="bg-gray-5 px-2 py-1">Port</div>
					<div class="bg-gray-5 px-2 py-1 text-right">{{ selectedServerData.port ?? "Unknown" }}</div>
					<div class="px-2 py-1">Max Players</div>
					<div class="px-2 py-1 text-right">{{ selectedServerData.maxplayers ?? "Unknown" }}</div>
					<div class="bg-gray-5 px-2 py-1">Uptime</div>
					<div class="bg-gray-5 px-2 py-1 text-right">{{ selectedServerData.uptime ?? "Unknown" }}</div>
					<div class="px-2 py-1">Has Password</div>
					<div class="px-2 py-1 text-right">{{ selectedServerData.serverpassword ?? "Unknown" }}</div>
				</div>

				<p class="font-main font-bold text-gray-7 px-5">RULES</p>
				<div v-if="ruleEntryCount" class="grid info-grid font-mono m-4 bg-gray-4 rounded-lg text-white-0">
					<template v-for="(value, rule, i) in selectedServerData.rules">
						<div :class="['px-2 py-1', {'bg-gray-5': i%2}]">{{ rule }}</div>
						<div :class="['px-2 py-1 text-right', {'bg-gray-5': i%2}]">{{ value }}</div>
					</template>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useServerStore } from '@/stores/serverStore';
import { BTN_VARIANT } from '@/util/constants';
import { PERMISSIONS } from '@/util/permissionValues';


export default {
	mixins: [],
	components: {
		
	},
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
