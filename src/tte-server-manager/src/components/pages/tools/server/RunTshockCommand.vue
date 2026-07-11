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
				<div class="relative flex items-center rounded-md overflow-hidden">
					<Icon icon="chevron-right" size="3" color="text-white-0" class="absolute left-2 my-auto top-0 bottom-0 h-max" />
					<AutoGrowTextarea
						ref="cmdInput"
						v-model="command" 
						:disabled="loadingResult"
						class="w-full bg-gray-1 outline-0 p-2 font-mono pl-8"
						@keydown.enter.exact.prevent="sendCommand"
						@keyup.up="historyPrevious"
						@keyup.down="historyNext"
					/>
					<p 
						class="hidden lg:inline absolute text-gray-6 right-4 font-mono text-right"
						:class="[{ 'invisible': !!command }]"
						@click="focusInput"
					>
						<span class="italic">↑/↓ - history</span>
						·
						<span class="italic">paste or shift+enter for batch mode</span>
					</p>
				</div>

				<div class="w-full bg-gray-1 rounded mt-4 font-mono text-sm text-gray-9 h-80 overflow-y-auto">
					<template v-for="lastCommand of lastCommandOutput">
						<div class="flex items-center bg-teal-0 px-4 py-1 mb-1">
							<Spinner v-if="lastCommand.loading" class="h-3 w-3 text-white-0 mr-2"/>
							<span class="mr-2">{{ lastCommand.loading ? "RUNNING" : "COMMAND" }}:</span>
							<span>{{ lastCommand.input }}</span>
						</div>
						<div class="px-4 mb-2">
							<span v-if="lastCommand.output" v-html="lastCommand.output"></span>
							<span v-else class="italic text-gray-6">No output</span>
						</div>
					</template>
					<template v-if="!lastCommandOutput.length">
						<div class="italic text-gray-6 ml-4 mt-2">No output</div>
					</template>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import AutoGrowTextarea from '@/components/common/AutoGrowTextarea.vue';
import CodeEditor from '@/components/common/CodeEditor.vue';
import Icon from '@/components/common/Icon.vue';
import LargeTextInput from '@/components/common/LargeTextInput.vue';
import Spinner from '@/components/common/Spinner.vue';
import { useServerStore } from '@/stores/serverStore';
import { post } from '@/util/api';
import { PERMISSIONS } from '@/util/permissionValues';


export default {
	mixins: [],
	components: {
		LargeTextInput,
		CodeEditor,
		AutoGrowTextarea,
	},
	props: {
		
	},
	data() {
		return {
			serverStore: useServerStore(),
			PERMISSIONS,
			command: "",
			lastCommandOutput: [],
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
				const results = [];
				const indivCommands = this.command.split("\n");
				this.command = "";
				this.lastCommandOutput = [];

				for (const cmd of indivCommands) {
					const validCmd = cmd.trim();
					if (!validCmd) continue;

					this.lastCommandOutput.push({ input: validCmd, output: "", loading: true });
					const result = await post(`/server/${this.selectedInstance}/tshock/command`, PERMISSIONS.server.tshock.execute, { command: validCmd });
					const resultSummary = { input: validCmd, output: result.response.join("<br/>") };
					results.push(resultSummary);
					this.lastCommandOutput[this.lastCommandOutput.length - 1] = resultSummary;
				}

				this.commandHistory.push(results);
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
				this.command = "";
				this.lastCommandOutput = [];
			} else {
				this.command = this.commandHistory[this.viewingHistory].reduce((complete, nextCmd) => complete + nextCmd.input + "\n", "").trim();
				this.lastCommandOutput = this.commandHistory[this.viewingHistory];
			}
		},
		focusInput() {
			this.$refs.cmdInput.focus();
		}
	},
}
</script>

<style scoped>

</style>
