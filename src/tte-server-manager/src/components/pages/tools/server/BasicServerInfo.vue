<template>
	<div class="flex flex-col sm:grid sm:grid-cols-4">
		<StatusTile 
			:class="['grow mt-4 sm:mt-8 sm:mx-1 gradient-tile', selectedServerData.state ? 'gradient-tile-green' : 'gradient-tile-red']"
			:collapsible="selectedServerData.state"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="power" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Server Status</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ selectedServerData.state ? 'RUNNING' : 'OFFLINE' }}</p>
			</template>
			<template #content>
				<div v-if="selectedServerData.state">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.server.status.stop)"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.DANGER"
						@input=""
					>
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:collapsible="false"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="people-group" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Players Online</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ selectedServerData.playercount ?? 'Unknown' }}</p>
			</template>
			<template #content>
				<!-- <div class="font-main font-semibold px-2 pb-2 text-teal-6 flex w-full flex-wrap">
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">havoc</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">exception</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">havoc</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">exception</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">havoc</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">exception</div>
				</div> -->
			</template>
		</StatusTile>

		<!-- <StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="earth" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Active World</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">{{ selectedServerData.world || 'Unknown' }}</p>
					<Spinner v-if="false" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
		</StatusTile> -->

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
			collapsible
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="circle-info" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Rules</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ Object.keys(selectedServerData.rules || {}).length }} entries</p>
			</template>
			<template #content>
				<div class="grid info-grid font-mono m-4 bg-gray-4 rounded-lg text-white-0">
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
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';

export default {
	mixins: [],
	components: {
		
	},
	props: {
		selectedServerData: {
			type: Object,
			required: true
		}
	},
	data() {
		return {
			BTN_VARIANT,
			PERMISSIONS,
		}
	},
	computed: {
		
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
