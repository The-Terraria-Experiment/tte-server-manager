<template>
	<StatusTile 
		class="grow mt-2 gradient-tile"
		collapsible
		:perm-required="PERMISSIONS.server.world.select"
		:loading="serverStore.loading.files[selectedInstance]"
	>
		<template #header>
			<Icon icon="rocket" color="text-gray-6" size="5" />
			<p class="text-gray-6 ml-2 text-lg">Launch World</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">{{ instanceWorldFiles.length }} world{{ plural(instanceWorldFiles.length) }} available</p>
		</template>
		<template #content v-if="serverIsAvailable">
			<p class="font-main font-bold text-gray-7 px-5">SELECT WORLD</p>
			<div class="mx-4 mt-1 mb-4 bg-gray-5 rounded-lg">
				<div :class="['grid px-2 py-2 overflow-x-auto', isMobile ? 'world-select-grid-mobile' : 'world-select-grid']">
					<template v-if="!isMobile">
						<div></div>
						<div class="font-main font-semibold text-teal-6 pb-2">World File Name</div>
						<div class="font-main font-semibold text-teal-6">File Size</div>
					</template>
					
					<template v-for="(world, idx) in instanceWorldFiles">
						<div :class="['p-2 rounded-l flex items-center', getWorldFileBG(idx)]">
							<Checkbox 
								class="h-4 w-4" 
								:value="selectWorld.selectedWorld === world.name"
								@input="selectWorldFile(world)"
							/>
						</div>
						<div :class="['flex items-center rounded-r sm:rounded-none', getWorldFileBG(idx)]" @click="selectWorldFile(world)">
							<p class="font-mono text-white-0 font-semibold text-sm cursor-pointer">{{ world.name }}</p>
						</div>
						<div v-if="!isMobile" :class="['flex items-center rounded-r pr-2', getWorldFileBG(idx)]">
							<p class="font-mono text-white-0 font-semibold text-sm">{{ formatFileSize(world.size) }}</p>
						</div>
					</template>
				</div>
			</div>

			<p class="font-main font-bold text-gray-7 px-5">WORLD OPTIONS</p>
			<div class="mb-4 mt-1 rounded-lg flex flex-col sm:grid grid-cols-3">
				<!-- <div class="bg-gray-5 rounded-lg p-4 flex flex-col">
					<p class="font-mono font-semibold text-teal-6 mb-2">Port</p>
					<ValueInput
						type="number"
						max="9999"
						min="1000"
						placeholder="Value between 1000 and 9999"
						v-model="selectWorld.port"
					/>
				</div> -->

				<div class="bg-gray-5 rounded-lg p-4 my-0 mx-4 flex flex-col">
					<p class="font-mono font-semibold text-teal-6 mb-2">Max Players</p>
					<ValueInput
						type="number"
						max="500"
						min="1"
						placeholder="Value between 1 and 500"
						v-model="selectWorld.maxplayers"
					/>
				</div>

				<!-- <div class="bg-gray-5 rounded-lg p-4 flex flex-col">
					<p class="font-mono font-semibold text-teal-6 mb-2">Password</p>
					<ValueInput
						maxlength="25"
						placeholder="Leave blank for none"
						v-model="selectWorld.password"
						:input-allowed="new Set(allowedPasswordChars)"
					/>
				</div> -->
			</div>

			<div class="flex justify-end p-4">
				<FlexButton 
					v-if="!serverStore.loading.worldLaunch[selectedInstance]"
					:variant="BTN_VARIANT.PRIMARY"
					@input="startServer"
					:disabled="!(selectWorld.selectedWorld && selectWorld.maxplayers && selectWorld.port && !serverStore.loading.worldLaunch[selectedInstance] && !selectedServerData.state)"
				>
					<p class="font-main font-bold py-2 px-4 md:px-10">START SERVER</p>
				</FlexButton>
				<div v-else-if="serverStore.loading.worldLaunch[selectedInstance]" class="flex items-center">
					<Spinner class="h-5 w-5 text-teal-3" />
					<p class="font-main font-bold text-teal-4 mx-2">SERVER STARTING...</p>
				</div>
			</div>
		</template>
		<template #content v-else>
			<p class="font-main font-bold text-gray-7 px-5">WORLD CREATION IN PROGRESS, PLEASE WAIT</p>
		</template>
	</StatusTile>
</template>

<script>
import screen from '../../../../mixins/screen';
import { useServerStore } from '../../../../stores/serverStore';
import { TASK_IDS } from '../../../../stores/statusStore';
import { useStatusStore } from '../../../../stores/statusStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT, WORLD_STATES } from '../../../../util/constants';
import { formatFileSize, plural } from '../../../../util/format';
import { PERMISSIONS } from '../../../../util/permissionValues';
import { getDateOffset } from '../../../../util/timeutils';
import Checkbox from '../../../common/Checkbox.vue';


export default {
	mixins: [screen],
	components: {
		Checkbox,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			statusStore: useStatusStore(),
			selectWorld: {
				selectedWorld: null,
				port: 7777,
				maxplayers: 16,
				password: ""
			},
			allowedPasswordChars: [
				...Array.from({length: 26}).map((_, i) => String.fromCharCode(97 + i)),
				...Array.from({ length: 26 }).map((_, i) => String.fromCharCode(65 + i)),
				...Array.from({ length: 10 }).map((_, i) => i.toString()),
				'_'
			],
			statusPollInterval: null,
		}
	},
	computed: {
		instanceWorldFiles() {
			const fileRoots = this.serverStore.instanceFileRoots[this.selectedInstance] || {};
			const worldPathNicknames = this.serverStore.instanceWorldPaths[this.selectedInstance] ?? [];
			const worldRoots = worldPathNicknames
				.filter(nickname => this.$checkResourceAccess(`filepath::${this.selectedInstance}::${nickname}`))
				.map(nickname => fileRoots[nickname])
				.filter((path) => !!path);
			return (this.serverStore.instanceFiles[this.selectedInstance] || [])
				.filter(p => worldRoots.some(root => p.key.startsWith(`${this.selectedInstance}${root}/`)))
				.map(s => ({ name: s.key.replace(this.selectedInstance, ""), size: s.size }));
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		selectedServerData() {
			return this.serverStore.selectedServerData;
		},
		serverIsAvailable() {
			return this.serverStore.worldStatusData[this.selectedInstance] === WORLD_STATES.OFFLINE;
		}
	},
	methods: {
		formatFileSize,
		plural,
		selectWorldFile(world) {
			if (this.selectWorld.selectedWorld === world.name) {
				this.selectWorld.selectedWorld = null;
			} else {
				this.selectWorld.selectedWorld = world.name;
			}
		},
		getWorldFileBG(index) {
			const world = this.instanceWorldFiles[index];
			if (this.selectWorld.selectedWorld === world.name) {
				return 'bg-teal-2';
			} else if (index % 2 === 0) {
				return 'bg-gray-4';
			}
		},
		async startServer() {
			this.$validatePermissions([PERMISSIONS.server.world.select, PERMISSIONS.server.status.start]);

			if (this.serverStore.loading.worldLaunch[this.selectedInstance]) return;

			if (this.selectWorld.port != 7777) {
				this.$alert.warning("Currently, the port must be 7777.");
				return;
			}

			if (this.selectWorld.password && !/^[a-zA-Z0-9_]+$/.test(this.selectWorld.password)) {
				this.$alert.warning("The password can only contain alphanumberic characters and underscores.");
				return;
			}

			if (this.selectWorld.maxplayers < 1 || this.selectWorld.maxplayers > 500) {
				this.$alert.warning("The player cap must be between 1 and 500");
				return;
			}

			if (!this.selectWorld.selectedWorld) {
				this.$alert.warning("Please select a world file");
				return;
			}

			this.serverStore.loading.worldLaunch[this.selectedInstance] = true;

			try {
				await post(`/server/${this.selectedInstance}/world/null_id/select`, PERMISSIONS.server.world.select, {
					worldFilePath: this.selectWorld.selectedWorld,
					port: this.selectWorld.port,
					maxPlayers: this.selectWorld.maxplayers,
					password: this.selectWorld.password ?? ""
				});
				this.$alert.success("Server starting");
				this.pollInstanceState();
			} catch (e) {
				if (e.message.includes("Instances not in a valid state")) {
					this.$alert.warning("Could not launch server: instance is not running or not responding");
				} else {
					this.$alert.error("Error launching server");
					console.error(e);
				}
			} finally {
				this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
			}
		},

		async fetchServerStatus() {
			this.$validatePermissions(PERMISSIONS.server.status.read);

			try {
				await this.serverStore.fetchServerStatus(this.selectedInstance);
			} catch (e) {
				if (e.message.includes("Request timed out for")) {
					this.$alert.warning("Could not fetch server status: instance is not running or not responding");
				} else {
					this.$alert.error("Error getting server status");
					console.error(e);
				}
			}
		},

		pollInstanceState() {
			this.statusStore.startRepeatingTask(TASK_IDS.SERVER_STATUS_CHECK, () => this.selectedServerData.state);
		}
	}
}
</script>

<style scoped>
@reference "../../../../theme.css";

.world-select-grid {
	grid-template-columns: auto 1fr auto;
}

.world-select-grid-mobile {
	grid-template-columns: auto 1fr;
}
</style>
