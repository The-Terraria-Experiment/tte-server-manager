<template>
	<StatusTile
		class="grow gradient-tile"
		collapsible
		:perm-required="PERMISSIONS.server.mods.read"
		:loading="loading"
	>
		<template #header>
			<Icon icon="file-code" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Mods</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">{{ summaryText }}</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<div class="flex items-center justify-between mb-2">
					<p class="font-mono text-xs text-gray-7">
						Changes take effect on the next launch. To install a mod, upload its .tmod to the mods folder on the Instance page.
					</p>
					<FlexButton
						class="px-2! ml-2"
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="arrow-rotate-right"
						leftIconSize="4"
						:disabled="loading"
						:loading="loading"
						@input="fetchMods"
					/>
				</div>

				<p v-if="modData && !modData.running" class="font-main text-gray-6 italic">
					Start the server to see its mods. The list comes from the running server.
				</p>
				<p v-else-if="modData && !modData.mods.length" class="font-main text-gray-6 italic">
					No mods installed.
				</p>

				<div v-else-if="modData" class="grid mod-grid text-white-0 font-mono text-sm overflow-x-auto">
					<div class="p-1 font-bold bg-teal-1">Enabled</div>
					<div class="p-1 font-bold bg-teal-1">Mod</div>
					<div class="p-1 font-bold bg-teal-1">Version</div>
					<div class="p-1 font-bold bg-teal-1">Status</div>
					<template v-for="(mod, i) in modData.mods" :key="mod.name">
						<div :class="[{ 'bg-gray-4': i % 2 }, 'p-1 flex items-center']">
							<Spinner v-if="pending === mod.name" class="h-4 w-4 text-teal-3" />
							<Checkbox
								v-else
								class="h-4 w-4"
								:value="mod.enabled"
								:disabled="!canToggle(mod)"
								@input="toggle(mod)"
							/>
						</div>
						<div :class="[{ 'bg-gray-4': i % 2 }, 'p-1']" :title="mod.name">{{ mod.displayName || mod.name }}</div>
						<div :class="[{ 'bg-gray-4': i % 2 }, 'p-1']">{{ mod.version ?? "Unknown" }}</div>
						<div :class="[{ 'bg-gray-4': i % 2 }, 'p-1', mod.enabled === mod.loaded ? 'text-gray-8' : 'text-yellow-2']">
							{{ statusText(mod) }}
						</div>
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
import Checkbox from '@/components/common/Checkbox.vue';
import FlexButton from '@/components/common/FlexButton.vue';
import Spinner from '@/components/common/Spinner.vue';

/** The site manages the server through it; the backend and the mod both refuse to disable it. */
const CONTROL_MOD = "TteControl";

/**
 * tModLoader mods on the selected instance: what's installed, what the next launch will load
 * (`enabled`) and what the running server loaded (`loaded`). The two differ after a toggle until the
 * next launch, which is why both are shown. Installing stays manual through the Instance Files page.
 */
export default {
	components: {
		Checkbox,
		FlexButton,
		Spinner,
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			/** Internal name of the mod whose toggle is in flight. One at a time: each rewrites enabled.json. */
			pending: null,
		};
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		modData() {
			return this.serverStore.getServerMods(this.selectedInstance);
		},
		loading() {
			return this.serverStore.isLoadingMods(this.selectedInstance);
		},
		serverOnline() {
			return this.serverStore.selectedServerData.state;
		},
		summaryText() {
			if (!this.modData) return "Unknown";
			if (!this.modData.running) return "Server offline";
			const enabled = this.modData.mods.filter(m => m.enabled).length;
			return `${enabled} of ${this.modData.mods.length} enabled`;
		},
	},
	methods: {
		canToggle(mod) {
			if (this.pending) return false;
			if (mod.name === CONTROL_MOD && mod.enabled) return false;
			return this.$checkPermissions(PERMISSIONS.server.mods.write);
		},
		statusText(mod) {
			if (mod.enabled && mod.loaded) return "Loaded";
			if (!mod.enabled && !mod.loaded) return "Off";
			return mod.enabled ? "Loads next launch" : "Unloads next launch";
		},
		async fetchMods() {
			if (!this.selectedInstance || !this.$checkPermissions(PERMISSIONS.server.mods.read)) return;
			try {
				await this.serverStore.fetchServerMods(this.selectedInstance);
			} catch (e) {
				this.$alert.error(e?.message || "Error reading mods");
			}
		},
		async toggle(mod) {
			if (!this.canToggle(mod)) return;
			this.$validatePermissions(PERMISSIONS.server.mods.write);

			this.pending = mod.name;
			try {
				await this.serverStore.setModEnabled(this.selectedInstance, mod.name, !mod.enabled);
				this.$alert.success(`${mod.displayName || mod.name} ${mod.enabled ? "disabled" : "enabled"}. Takes effect on the next launch.`);
			} catch (e) {
				this.$alert.error(e?.message || "Error changing mod");
			} finally {
				this.pending = null;
			}
		},
	},
	mounted() {
		this.fetchMods();
	},
	watch: {
		selectedInstance() {
			this.fetchMods();
		},
		// The list only exists while the server runs, so a launch or stop changes what there is to show.
		serverOnline() {
			this.fetchMods();
		},
	},
};
</script>

<style scoped>
.mod-grid {
	grid-template-columns: auto 1fr auto auto;
}
</style>
