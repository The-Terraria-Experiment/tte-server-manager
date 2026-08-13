<template>
	<StatusTile
		:permRequired="[PERMISSIONS.server.player.inventory.rules.read, PERMISSIONS.server.player.inventory.violations.read]"
		:matchAnyPermission="true"
		:loading="loading"
		collapsible
	>
		<template #header>
			<Icon :icon="flaggedCount ? 'warning' : 'gavel'" :color="flaggedCount ? 'text-yellow-2' : 'text-gray-6'" size="4" />
			<p class="ml-2 text-lg" :class="flaggedCount ? 'text-yellow-2' : 'text-gray-6'">Item Rules</p>
		</template>
		<template #summary>
			<p class="text-2xl" :class="flaggedCount ? 'text-yellow-2' : 'text-teal-4'">{{ summaryText }}</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<ItemRulesEditorPopup
					:open="editorOpen"
					:rules="rules"
					:loading="saving"
					:disabled="!$checkPermissions(PERMISSIONS.server.player.inventory.rules.write)"
					@cancel="editorOpen = false"
					@apply="onSave"
				/>

				<!-- Flagged players first: this is the part anyone opening the tile is here for. -->
				<div v-if="flaggedCount" class="mb-4">
					<p class="font-main font-bold text-gray-7 mb-2">FLAGGED PLAYERS</p>
					<div class="flex flex-wrap gap-2">
						<div
							v-for="violation in flaggedList"
							:key="violation.player"
							class="rounded-lg border border-yellow-2 bg-gray-4 p-3 w-full sm:w-72"
						>
							<div class="flex items-center justify-between">
								<p class="font-main font-bold text-yellow-2 break-all">{{ violation.player }}</p>
								<p class="font-mono text-xs text-gray-7 ml-2 shrink-0">{{ relativeTime(violation.at) }}</p>
							</div>
							<p class="mt-1 font-mono text-sm text-white-0">
								{{ violation.itemCount }} flagged item{{ violation.itemCount === 1 ? '' : 's' }}
								<span class="text-gray-7">({{ violation.mode }})</span>
							</p>
							<div class="flex flex-wrap gap-1 mt-2">
								<InventorySlot
									v-for="(item, index) in violation.items.slice(0, 12)"
									:key="`${item.container}-${item.globalSlot}-${index}`"
									:item="item"
									:size="28"
									:label="`${item.container} slot ${item.slot}`"
								/>
								<p v-if="violation.items.length > 12" class="self-end font-mono text-xs text-gray-7">
									+{{ violation.items.length - 12 }} more
								</p>
							</div>
						</div>
					</div>
				</div>

				<div class="font-mono text-sm text-gray-7">
					<!--
						Rule details only for someone who can read them. A violations-only viewer would
						otherwise be shown fabricated defaults as though they were the configuration —
						the same trap `configured` exists to close on the endpoint.
					-->
					<p v-if="canReadRules">
						Mode:
						<span class="text-white-0">{{ rules?.mode || 'blacklist' }}</span>
						·
						Entries:
						<span class="text-white-0">{{ rules?.entries?.length || 0 }}</span>
						·
						Status:
						<span :class="rules?.enabled ? 'text-teal-4' : 'text-gray-8'">{{ rules?.enabled ? 'enabled' : 'disabled' }}</span>
					</p>
					<p v-if="canReadRules && !rules?.configured" class="text-gray-8 mt-1">
						No rules configured for this server — values shown are defaults.
					</p>
					<p v-if="meta?.lastScanAt" class="mt-1">
						Last checked <span class="text-white-0">{{ relativeTime(meta.lastScanAt) }}</span>
						<span v-if="meta.lastScanStatus && meta.lastScanStatus !== 'ok'" class="text-yellow-2">
							({{ meta.lastScanStatus }})
						</span>
					</p>
				</div>

				<div class="flex flex-col sm:flex-row gap-4 mt-4">
					<FlexButton
						v-if="canReadRules"
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="edit"
						@input="editorOpen = true"
					>
						EDIT RULES
					</FlexButton>
					<FlexButton
						v-if="$checkPermissions(PERMISSIONS.server.player.inventory.violations.read)"
						:variant="BTN_VARIANT.SUBTLE"
						leftIcon="sync"
						:loading="scanning"
						@input="onScan"
					>
						SCAN NOW
					</FlexButton>
				</div>

				<!--
					Sound and desktop notifications both need a user gesture: the browser's permission
					prompt requires one, and an AudioContext created outside one starts suspended and stays
					silent. Enabling from this click is what licenses both.
				-->
				<div v-if="$checkPermissions(PERMISSIONS.server.player.inventory.violations.read)" class="mt-4 flex items-start">
					<Checkbox :modelValue="notificationsOn" @update:modelValue="onToggleNotifications" />
					<div class="ml-2">
						<p class="font-main font-semibold text-sm text-white-0">Notify me about violations</p>
						<p class="font-mono text-xs text-gray-7">
							Plays a sound and raises a desktop notification when someone joins this server with a
							flagged item. Applies to this browser only.
						</p>
						<p v-if="notificationsOn && permissionState === 'denied'" class="font-mono text-xs text-yellow-2 mt-1">
							This browser is blocking notifications — the sound will still play. Allow notifications
							for this site in your browser settings to see them.
						</p>
					</div>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { PERMISSIONS } from '../../../../util/permissionValues';
import { BTN_VARIANT } from '../../../../util/constants';
import StatusTile from '../../../common/StatusTile.vue';
import Icon from '../../../common/Icon.vue';
import FlexButton from '../../../common/FlexButton.vue';
import Checkbox from '../../../common/Checkbox.vue';
import InventorySlot from './basic/players/InventorySlot.vue';
import ItemRulesEditorPopup from './items/ItemRulesEditorPopup.vue';
import { useSpriteStore } from '../../../../stores/spriteStore';
import {
	disableNotifications,
	enableNotifications,
	notificationPermission,
	notificationsEnabled,
} from '../../../../util/notify';

export default {
	components: {
		StatusTile,
		Icon,
		FlexButton,
		Checkbox,
		InventorySlot,
		ItemRulesEditorPopup,
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			spriteStore: useSpriteStore(),
			editorOpen: false,
			saving: false,
			notificationsOn: notificationsEnabled(),
			permissionState: notificationPermission(),
		};
	},
	computed: {
		instanceID() {
			return this.serverStore.selectedInstanceID;
		},
		canReadRules() {
			return this.$checkPermissions(PERMISSIONS.server.player.inventory.rules.read);
		},
		rules() {
			return this.serverStore.getItemRules(this.instanceID);
		},
		meta() {
			return this.serverStore.getViolationsMeta(this.instanceID);
		},
		loading() {
			return this.serverStore.isLoadingItemRules(this.instanceID) || this.serverStore.isLoadingViolations(this.instanceID);
		},
		scanning() {
			return this.serverStore.isScanningItems(this.instanceID);
		},
		flaggedList() {
			// Newest first: the most recent join is the one someone is most likely acting on.
			return Object.values(this.serverStore.getViolations(this.instanceID)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
		},
		flaggedCount() {
			return this.flaggedList.length;
		},
		summaryText() {
			if (this.flaggedCount) {
				return `${this.flaggedCount} player${this.flaggedCount === 1 ? '' : 's'} flagged`;
			}
			// Only claim "not enforcing" to someone who can actually see the rules; to anyone else a
			// null rules object means "not fetched", not "switched off".
			if (this.canReadRules && !this.rules?.enabled) return 'Not enforcing';
			return 'No violations';
		},
	},
	methods: {
		relativeTime(timestamp) {
			if (!timestamp) return 'never';

			const seconds = Math.round((Date.now() - timestamp) / 1000);
			if (seconds < 60) return 'just now';
			if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
			if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
			return `${Math.floor(seconds / 86400)}d ago`;
		},
		async load() {
			if (!this.instanceID) return;

			if (this.$checkPermissions(PERMISSIONS.server.player.inventory.rules.read)) {
				try {
					await this.serverStore.fetchItemRules(this.instanceID);
				} catch (e) {
					this.$alert.error("Error fetching item rules");
					console.error(e);
				}
			}

			if (this.$checkPermissions(PERMISSIONS.server.player.inventory.violations.read)) {
				try {
					// Never with notify: this runs on page load, and announcing whatever was already
					// flagged would fire a notification every time someone opened the server page.
					await this.serverStore.fetchViolations(this.instanceID);
				} catch (e) {
					this.$alert.error("Error fetching item violations");
					console.error(e);
				}
			}
		},
		async onSave(rules) {
			this.$validatePermissions(PERMISSIONS.server.player.inventory.rules.write);

			if (this.saving) return;
			this.saving = true;

			try {
				await this.serverStore.saveItemRules(this.instanceID, rules);
				this.$alert.success("Item rules saved");
				this.editorOpen = false;
			} catch (e) {
				this.$alert.error(e?.message || "Error saving item rules");
				console.error(e);
			} finally {
				this.saving = false;
			}
		},
		async onScan() {
			this.$validatePermissions(PERMISSIONS.server.player.inventory.violations.read);

			try {
				await this.serverStore.requestItemScan(this.instanceID);
				// The scan is asynchronous, and its results arrive over the socket. Saying "queued" rather
				// than "complete" is the honest report — and on a socket-less client the refresh below is
				// what surfaces them.
				this.$alert.success("Scan queued");
			} catch (e) {
				if (e?.code === "RULES_INACTIVE") {
					this.$alert.warning("Item rules are not enabled, or the list is empty");
				} else {
					this.$alert.error("Error queueing scan");
					console.error(e);
				}
			}
		},
		async onToggleNotifications(enabled) {
			if (!enabled) {
				disableNotifications();
				this.notificationsOn = false;
				return;
			}

			const permission = await enableNotifications();
			this.permissionState = permission;
			this.notificationsOn = true;
		},
	},
	mounted() {
		// The flagged-player cards draw item sprites, and this tile can be the first thing on the page
		// to need the atlas — the inventory popup is otherwise what pulls it in. Idempotent.
		this.spriteStore.loadAtlas();
		this.load();
	},
	watch: {
		instanceID() {
			this.load();
		},
	},
};
</script>

<style scoped>

</style>
