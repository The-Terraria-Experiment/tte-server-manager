<template>
	<StatusTile
		:class="['mt-2']"
		:perm-required="PERMISSIONS.server.tshock.execute"
		:loading="loadingResult"
		collapsible
	>
		<template #header>
			<Icon icon="terminal" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Execute Commands</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<div class="relative flex items-center">
					<Icon icon="chevron-right" size="3" color="text-white-0" class="absolute left-2 my-auto top-0 bottom-0 h-max" />
					<input 
						type="text" 
						v-model="command"
						class="bg-gray-1! outline-0 font-mono! w-full pl-8!" 
						@keyup.enter="sendCommand"
						@keyup.up="historyPrevious"
						@keyup.down="historyNext"
					/>
				</div>

				<div class="w-full bg-gray-1 rounded mt-4 py-2 px-3 font-mono text-gray-9">
					<span v-if="lastCommandOutput" v-html="lastCommandOutput"></span>
					<span v-else class="italic text-gray-6">No output</span>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import Icon from '@/components/common/Icon.vue';
import { useServerStore } from '@/stores/serverStore';
import { post } from '@/util/api';
import { PERMISSIONS } from '@/util/permissionValues';


export default {
	mixins: [],
	components: {
		
	},
	props: {
		
	},
	data() {
		return {
			serverStore: useServerStore(),
			PERMISSIONS,
			command: "",
			lastCommandOutput: "",
			loadingResult: false,
			commandHistory: [],
			viewingHistory: -1, // -1 is not viewing history, empty input/output
		}
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		selectedServerData() {
			return this.serverStore.selectedServerData;
		}
	},
	methods: {
		async sendCommand() {
			this.$validatePermissions(PERMISSIONS.server.tshock.execute);

			if (this.loadingResult) return;
			this.loadingResult = true;

			try {
				const result = await post(`/server/${this.selectedInstance}/tshock/command`, PERMISSIONS.server.tshock.execute, { command: this.command });
				this.lastCommandOutput = result.response.join("<br/>");
				this.commandHistory.push({ input: this.command, output: this.lastCommandOutput });
				this.command = "";
				this.viewingHistory = -1;
			} catch (e) {
				this.$alert.error("Error executing command");
				console.error(e);
			} finally {
				this.loadingResult = false;
			}
		},
		historyPrevious() {
			if (this.viewingHistory === -1) {
				this.viewingHistory = this.commandHistory.length - 1;
			} else if (this.viewingHistory > 0) {
				this.viewingHistory--;
			}

			this.displayHistory();
		},
		historyNext() {
			if (this.viewingHistory < this.commandHistory.length - 1 && this.viewingHistory !== -1) {
				this.viewingHistory++;
			} else if (this.viewingHistory === this.commandHistory.length - 1) {
				this.viewingHistory = -1;
			}

			this.displayHistory();
		},
		displayHistory() {
			if (this.viewingHistory === -1) {
				this.command = this.lastCommandOutput = "";
			} else {
				this.command = this.commandHistory[this.viewingHistory].input;
				this.lastCommandOutput = this.commandHistory[this.viewingHistory].output;
			}
		}
	},
}
</script>

<style scoped>

</style>
