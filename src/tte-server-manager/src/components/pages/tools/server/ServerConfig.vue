<template>
	<StatusTile 
		:class="['mt-4 sm:mt-8']"
		collapsible
		:perm-required="PERMISSIONS.server.config.read"
		:loading="loadingSaveConfig"
	>
		<template #header>
			<Icon icon="gear" color="text-gray-6" size="5" />
			<p class="text-gray-6 ml-2 text-lg">Server Config</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">{{ summaryText }}</p>
		</template>
		<template #content>
			<div class="p-4">
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
						class="bg-gray-4 hover:bg-gray-2 w-max pl-4 pr-6 py-2"
						:disabled="false"
						@input="reloadConfig"
					>
						<div class="flex items-center">
							<Spinner v-if="false" class="h-4 w-4 text-teal-3" thickness="4" />
							<Icon v-else icon="arrow-rotate-right" color="text-teal-3" size="4" />
							<p class="text-teal-3 ml-2 font-main font-bold flex">RELOAD CONFIG IN TSHOCK</p>
						</div>
					</FlexButton>
				</div>

				<div>
					<div class="font-mono text-xs sm:text-sm">
						<LargeTextInput
							placeholder="Config not loaded or not found"
							:disabled="!$checkPermissions(PERMISSIONS.server.config.write)"
							ref="configInput"
							v-model="configText"
							class="mt-4 rounded w-full min-h-100"
							@keydown.tab.prevent="insertTab"
						/>
					</div>
					<div v-if="!jsonIsValid" class="flex items-center bg-gray-1 w-max py-2 px-4 rounded mt-2">
						<Icon icon="warning" size="4" color="text-red-5" />
						<p class="font-mono text-red-5 ml-2">Invalid JSON</p>
					</div>
				</div>

				<div class="flex justify-end w-full mt-4" v-if="dirtyConfig && !loadingSaveConfig">
					<FlexButton
						:variant="BTN_VARIANT.DANGER"
						@input="resetConfig"
						class="mr-4"
					>
						<p class="font-main font-bold py-2 px-8 md:px-12">DISCARD</p>
					</FlexButton>
					<FlexButton
						:variant="BTN_VARIANT.PRIMARY"
						@input="saveConfig"
					>
						<p class="font-main font-bold py-2 px-8 md:px-12">SAVE</p>
					</FlexButton>
				</div>
				<div v-else-if="loadingSaveConfig" class="flex items-center justify-end mt-8 mr-4 mb-4">
					<Spinner class="h-5 w-5 text-teal-3" />
					<p class="font-main font-bold text-teal-4 mx-2">SAVING...</p>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import FlexButton from '../../../common/FlexButton.vue';
import LargeTextInput from '../../../common/LargeTextInput.vue';

export default {
	mixins: [],
	components: {
		LargeTextInput,
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
		}
	},
	computed: {
		dirtyConfig() {
			return this.configText !== JSON.stringify(this.serverStore.serverConfigs[this.selectedInstance]?.config, null, 2);
		},
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
		}
	},
	methods: {
		insertTab() {
			const input = this.$refs.configInput.$el;
			const start = input.selectionStart;
			const end = input.selectionEnd;
			
			// Insert 2 spaces at the cursor position
			this.configText = this.configText.substring(0, start) + '  ' + this.configText.substring(end);
			
			// Move cursor after the inserted spaces
			this.$nextTick(() => {
				input.selectionStart = input.selectionEnd = start + 2;
			});
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
