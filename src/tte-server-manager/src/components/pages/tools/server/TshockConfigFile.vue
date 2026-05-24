<template>
	<StatusTile 
		:class="['mt-2']"
		:perm-required="PERMISSIONS.server.config.read"
		:loading="loadingSaveConfig"
	>
		<template #header>
			<Icon icon="gear" color="text-gray-6" size="5" />
			<p class="text-gray-6 ml-2 text-lg">Main TShock Config</p>
		</template>
		<template #summary>
			<div class="w-full">
				<div class="bg-gray-2 px-4 pt-4 pb-2 rounded-md">
					<p class="font-main font-bold text-gray-7">TOP SETTINGS</p>
					<div class="flex gap-2 pt-2 text-sm overflow-x-auto">
						<div v-for="highlight in highlightedEntries" class="flex font-mono bg-blue-1 rounded-md text-white mb-2">
							<div class="pl-4 pt-2">{{ highlight }}:</div>
							<div class="bg-blue-0 py-2 px-4 rounded-md ml-2">"{{ configAsJson["Settings"][highlight] }}"</div>
						</div>
					</div>
				</div>
			</div>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<div class="flex gap-4">
					<!-- Currently I don't think S3 pricing is expensive enough to need this, but it's here if we want to limit the bucket reads a bit -->
					<!-- <FlexButton
						class="bg-gray-4 hover:bg-gray-2 w-max pl-4 pr-6 py-2"
						:disabled="false"
						@input="fetchServerConfig"
					>
						<div class="flex items-center">
							<Spinner v-if="false" class="h-4 w-4 text-teal-3" thickness="4" />
							<Icon v-else icon="cloud-download" color="text-teal-3" size="5" />
							<p class="text-teal-3 ml-2 font-main font-bold flex">FETCH CURRENT CONFIG</p>
						</div>
					</FlexButton> -->

					<!-- <FlexButton
						class="bg-gray-4 hover:bg-gray-2 w-max pl-4 pr-6 py-2"
						:disabled="false"
					>
						<div class="flex items-center">
							<Spinner v-if="false" class="h-4 w-4 text-teal-3" thickness="4" />
							<Icon v-else icon="sync" color="text-teal-3" size="5" />
							<p class="text-teal-3 ml-2 font-main font-bold flex">RESYNC CONFIG FILE</p>
						</div>
					</FlexButton> -->

					<FlexButton
						v-if="selectedServerData.state"
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="arrow-rotate-right"
						:disabled="false"
						@input="reloadConfig"
						class="mb-4"
					>
						RELOAD CONFIG IN TSHOCK
					</FlexButton>
				</div>

				<div>
					<FlexButton
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="edit"
						leftIconSize="5"
						:disabled="false"
						@input="editorOpen = true"
					>
						EDIT CONFIG
					</FlexButton>

					<CodeEditor 
						:open="editorOpen"
						v-model="configText" 
						@cancel="editorOpen = false"
						@save="saveAndCloseEditor"
					/>

					<div v-if="!jsonIsValid" class="flex items-center bg-gray-1 w-max py-2 px-4 rounded mt-2">
						<Icon icon="warning" size="4" color="text-red-5" />
						<p class="font-mono text-red-5 ml-2">Invalid JSON</p>
					</div>
				</div>

				<div v-if="loadingSaveConfig" class="flex items-center justify-end mt-8 mr-4 mb-4">
					<Spinner class="h-5 w-5 text-teal-3" />
					<p class="font-main font-bold text-teal-4 mx-2">SAVING...</p>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import CodeEditor from '../../../common/CodeEditor.vue';
import { useServerStore } from '../../../../stores/serverStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import FlexButton from '../../../common/FlexButton.vue';
import LargeTextInput from '../../../common/LargeTextInput.vue';
import Icon from '@/components/common/Icon.vue';

export default {
	mixins: [],
	components: {
		LargeTextInput,
		CodeEditor,
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
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			configText: "",
			loadingSaveConfig: false,
			editorOpen: false,
			highlightedEntries: [
				"ServerPassword",
				"MaxSlots",
				"HardcoreOnly",
				"MediumcoreOnly",
				"SoftcoreOnly"
			]
		}
	},
	computed: {
		jsonIsValid() {
			try {
				JSON.parse(this.configText);
				return true;
			} catch (e) {
				return false;
			}
		},
		summaryText() {
			if (!this.serverStore.serverConfigs[this.selectedInstance]) {
				return 'Unknown config';
			}
			return this.serverStore.serverConfigs[this.selectedInstance]?.isDefaultConfig ? 'Default configuration' : 'Custom configuration';
		},
		configAsJson() {
			try {
				const parsed = JSON.parse(this.configText);
				return parsed;
			} catch (e) {
				return { "Settings": {} };
			}
		}
	},
	methods: {
		saveAndCloseEditor() {
			this.editorOpen = false;
			this.saveConfig();
		},

		async fetchServerConfig() {
			this.$validatePermissions(PERMISSIONS.server.config.read);

			if (!this.selectedInstance) return;

			try {
				await this.serverStore.fetchServerConfig(this.selectedInstance);
				this.configText = JSON.stringify(this.serverStore.serverConfigs[this.selectedInstance]?.config, null, 2);
			} catch (e) {
				this.$alert.error("Error getting server config");
				console.error(e);
			}
		},

		async saveConfig() {
			this.$validatePermissions(PERMISSIONS.server.config.write);

			if (this.loadingSaveConfig) return;
			this.loadingSaveConfig = true;

			try {
				JSON.stringify(JSON.parse(this.configText));
			} catch (e) {
				this.$alert.error("Config is not valid JSON");
				return;
			}

			try {
				const response = await post(`/server/${this.selectedInstance}/config`, PERMISSIONS.server.config.write, { config: JSON.parse(this.configText) });
				this.$alert.success("Config saved");
			} catch (e) {
				this.$alert.error("Error saving config");
				console.error(e);
			} finally {
				this.loadingSaveConfig = false;
			}
		},

		resetConfig() {
			this.configText = JSON.stringify(this.serverStore.serverConfigs[this.selectedInstance]?.config, null, 2);
		},

		async reloadConfig() {
			this.$validatePermissions(PERMISSIONS.server.config.write);

			if (this.loadingSaveConfig) return;
			this.loadingSaveConfig = true;

			try {
				await post(`/server/${this.selectedInstance}/config/reload`, PERMISSIONS.server.config.write, {});
				this.$alert.success("Config reloaded");
			} catch (e) {
				this.$alert.error("Error reloading config");
			} finally {
				this.loadingSaveConfig = false;
			}
		}
	},
	mounted() {
		if (this.$checkPermissions(PERMISSIONS.server.config.read)) {
			this.fetchServerConfig();
		}
	},
	watch: {
		selectedInstance() {
			if (this.$checkPermissions(PERMISSIONS.server.config.read)) {
				this.fetchServerConfig();
			}
		}
	}
}
</script>

<style scoped>

</style>
