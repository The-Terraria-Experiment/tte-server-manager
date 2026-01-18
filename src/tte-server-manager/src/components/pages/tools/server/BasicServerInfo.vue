<template>
	<div class="flex flex-col sm:grid sm:grid-cols-4">
		<StatusTile 
			:class="['grow mt-4 sm:mt-8 sm:mx-1 gradient-tile', selectedServerData.state ? 'gradient-tile-green' : 'gradient-tile-red']"
			:collapsible="selectedServerData.state"
			:perm-required="PERMISSIONS.server.status.read"
			:loading="statusLoading"
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
						@input="stopServer"
					>
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:collapsible="!!selectedServerData.playercount"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="people-group" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Players</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ playerCountText }}</p>
			</template>
			<template #content>
				<div v-if="selectedServerData.players?.length" class="font-main font-semibold px-2 pb-2 text-teal-6 flex w-full flex-wrap">
					<template v-for="player in selectedServerData.players">
						<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">{{ player.nickname }}</div>
					</template>
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
				<Icon icon="scroll" color="text-gray-6" size="5" />
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
import { post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { plural } from '../../../../util/format';
import { PERMISSIONS } from '../../../../util/permissionValues';

export default {
	mixins: [],
	components: {
		
	},
	props: {
		selectedServerData: {
			type: Object,
			required: true
		},
		selectedInstance: {
			type: [String, null],
			required: true
		},
	},
	data() {
		return {
			BTN_VARIANT,
			PERMISSIONS,
			statusLoading: false
		}
	},
	computed: {
		playerCountText() {
			if (typeof this.selectedServerData.playercount === 'number') {
				return `${this.selectedServerData.playercount} player${plural(this.selectedServerData.playercount || 0)} online`
			}
			return 'Unknown';
		}
	},
	methods: {
		async stopServer() {
			this.$validatePermissions(PERMISSIONS.server.status.stop);

			if (this.statusLoading) return;
			this.statusLoading = true;

			try {
				const response = await post(`/server/${this.selectedInstance}/stop`, PERMISSIONS.server.status.stop);
				this.$alert.success("Server stopping");
			} catch (e) {
				this.$alert.error("Error stopping server");
				console.error(e);
			} finally {
				this.statusLoading = false;
			}
		}
	},
}
</script>

<style scoped>
.info-grid {
	grid-template-columns: 1fr auto;
}
</style>
