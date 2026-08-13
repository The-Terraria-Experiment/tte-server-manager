<template>
	<Popup
		:open="open"
		header-text="ITEM RULES"
		:buttons="popupButtons"
		:x-disabled="loading"
		:close-when-bg-clicked="!loading"
		@x-clicked="onCancel"
		body-class="w-11/12 sm:w-3/4 lg:w-1/2 h-3/4"
	>
		<div class="p-4 h-full overflow-y-auto">
			<!--
				Presets are a site-wide library of saved rulesets. LOAD only fills the draft below — the
				SAVE button is still what applies anything to this server, so nothing here changes
				enforcement on its own. Hidden entirely without write permission: loading a preset into a
				draft that can't be saved is a dead end.
			-->
			<div v-if="!disabled" class="mb-4 pb-4 border-b border-gray-5">
				<p class="font-bold mb-1">Preset</p>
				<div class="flex items-end gap-2">
					<div class="grow min-w-0">
						<Dropdown
							v-model="selectedPresetId"
							:options="presetOptions"
							placeholder="Choose a saved ruleset…"
							inputClass="bg-teal-3 text-white-1"
							iconColor="text-white-1"
							:disabled="presetsBusy || !presetOptions.length"
						/>
					</div>
					<FlexButton
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="download"
						:disabled="!selectedPresetId || presetsBusy"
						:loading="loadingPreset"
						@input="onLoadPreset"
					>
						LOAD
					</FlexButton>
					<div
						v-if="selectedPresetId && !confirmingDelete"
						class="cursor-pointer shrink-0 pb-2"
						@click="confirmingDelete = true"
					>
						<Icon icon="trash-can" size="4" color="text-gray-7" />
					</div>
				</div>

				<p v-if="!presetOptions.length && !presetsStore.loading" class="font-mono text-xs text-gray-7 mt-1">
					No presets saved yet. Build a list below, then use SAVE AS PRESET to reuse it on other servers.
				</p>

				<!-- Inline rather than a nested Popup, which would stack a modal on a modal. -->
				<div v-if="confirmingDelete" class="mt-2 flex items-center gap-2 flex-wrap">
					<p class="font-mono text-xs text-yellow-2 grow">
						Delete preset “{{ selectedPresetName }}”? Servers that already loaded it keep their rules.
					</p>
					<FlexButton :variant="BTN_VARIANT.SECONDARY" @input="confirmingDelete = false">CANCEL</FlexButton>
					<FlexButton :variant="BTN_VARIANT.DANGER" :disabled="deletingPreset" @input="onDeletePreset">
						<p class="font-main font-bold py-2 px-4">DELETE</p>
					</FlexButton>
				</div>

				<div v-if="namingPreset" class="mt-2">
					<div class="flex items-end gap-2">
						<div class="grow">
							<p class="font-mono text-xs text-gray-7 mb-1">Preset name</p>
							<ValueInput
								placeholder="e.g. Vanilla only"
								v-model="presetName"
								@keyup.enter="onSavePreset(null)"
							/>
						</div>
						<FlexButton :variant="BTN_VARIANT.SECONDARY" @input="namingPreset = false">CANCEL</FlexButton>
						<FlexButton :variant="BTN_VARIANT.SECONDARY" leftIcon="checkmark" :loading="savingPreset" @input="onSavePreset(null)">
							SAVE
						</FlexButton>
					</div>
				</div>
				<div v-else class="mt-2 flex flex-wrap gap-2">
					<FlexButton :variant="BTN_VARIANT.SECONDARY" leftIcon="plus" :disabled="presetsBusy" @input="onSaveAsClicked">
						SAVE AS PRESET
					</FlexButton>
					<FlexButton
						v-if="selectedPresetId"
						:variant="BTN_VARIANT.SECONDARY"
						:disabled="presetsBusy"
						:loading="savingPreset"
						@input="onSavePreset(selectedPresetId)"
					>
						UPDATE “{{ selectedPresetName }}”
					</FlexButton>
				</div>
			</div>

			<div class="flex items-start mb-4">
				<Checkbox v-model="draft.enabled" :disabled="disabled" />
				<div class="ml-2">
					<p class="font-main font-semibold text-white-0">Check joining players against this list</p>
					<p class="font-mono text-xs text-gray-7">
						Players are checked when they join. Nothing is removed and nobody is kicked — violations
						are reported here and on the player.
					</p>
				</div>
			</div>

			<div class="mb-4">
				<p class="font-bold mb-1">Mode</p>
				<Dropdown
					v-model="draft.mode"
					:options="modeOptions"
					inputClass="bg-teal-3 text-white-1"
					iconColor="text-white-1"
					:disabled="disabled"
				/>
				<p class="font-mono text-xs mt-1" :class="draft.mode === 'whitelist' ? 'text-yellow-2' : 'text-gray-7'">
					{{ modeHint }}
				</p>
			</div>

			<div class="mb-4">
				<p class="font-bold mb-1">Where to look</p>
				<div class="flex flex-wrap gap-4">
					<div v-for="group in GROUPS" :key="group.id" class="flex items-center">
						<Checkbox
							:modelValue="draft.groups.includes(group.id)"
							:disabled="disabled"
							@update:modelValue="toggleGroup(group.id, $event)"
						/>
						<p class="ml-2 font-main text-sm text-white-0">{{ group.label }}</p>
					</div>
				</div>
				<p class="font-mono text-xs text-gray-7 mt-1">
					Narrowing this makes each check cheaper, since the server only reports the containers asked for.
				</p>
			</div>

			<div v-if="!disabled" class="mb-4">
				<p class="font-bold mb-1">Add items</p>

				<!--
					Name search is only possible when the item-name map is published beside the sprite
					atlas. It comes from a running game server rather than the game files, so an older
					sprite version legitimately has none — hence the ID box below, which always works.
				-->
				<ValueInput
					v-if="namesAvailable"
					placeholder="Search by name, e.g. 'zenith'"
					v-model="searchQuery"
				/>
				<p v-else class="font-mono text-xs text-yellow-2 mb-1">
					No item-name list published for this sprite version — add by ID below. See
					src/sprite-tools/README.md to publish one.
				</p>

				<div v-if="searchResults.length" class="mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-5">
					<div
						v-for="result in searchResults"
						:key="result.netId"
						class="flex items-center p-2 border-b border-gray-5 last:border-b-0"
						:class="isListed(result.netId) ? 'bg-gray-3' : 'bg-gray-4 cursor-pointer hover:bg-gray-5'"
						@click="addFromSearch(result)"
					>
						<InventorySlot :item="slotFor(result)" :size="28" />
						<div class="ml-2 min-w-0 grow">
							<p class="font-main text-white-0 truncate">{{ result.name }}</p>
							<p class="font-mono text-xs text-gray-7">ID {{ result.netId }}</p>
						</div>
						<p v-if="isListed(result.netId)" class="font-mono text-xs text-teal-5 shrink-0 ml-2">on list</p>
					</div>
				</div>
				<p v-else-if="searchQuery.trim().length >= MIN_QUERY" class="font-mono text-xs text-gray-7 mt-2">
					Nothing matches “{{ searchQuery.trim() }}”.
				</p>

				<div class="mt-3 flex items-end gap-2">
					<div class="grow">
						<p class="font-mono text-xs text-gray-7 mb-1">…or by ID</p>
						<ValueInput
							type="number"
							placeholder="e.g. 3384"
							v-model="draftNetId"
							@keyup.enter="addById"
						/>
					</div>
					<FlexButton :variant="BTN_VARIANT.SECONDARY" leftIcon="plus" @input="addById">
						ADD
					</FlexButton>
				</div>
			</div>

			<p class="font-bold mb-2">
				List
				<span class="font-mono text-sm text-gray-7">({{ draft.entries.length }})</span>
			</p>
			<p v-if="!draft.entries.length" class="font-mono text-sm text-gray-8 mb-4">
				Nothing listed yet. An empty list is never enforced, whichever mode is selected.
			</p>
			<div class="flex flex-wrap gap-2">
				<div
					v-for="entry in draft.entries"
					:key="entry.netId"
					class="flex items-center rounded-lg border border-gray-5 bg-gray-4 p-2 w-full sm:w-64"
				>
					<InventorySlot :item="slotFor(entry)" :size="32" />
					<div class="ml-2 min-w-0 grow">
						<p class="font-main font-semibold text-white-0 truncate">{{ displayName(entry) }}</p>
						<p class="font-mono text-xs text-gray-7">ID {{ entry.netId }}</p>
					</div>
					<div v-if="!disabled" class="cursor-pointer shrink-0 ml-2" @click="removeEntry(entry.netId)">
						<Icon icon="trash-can" size="4" color="text-gray-7" />
					</div>
				</div>
			</div>
		</div>
	</Popup>
</template>

<script>
import Popup from '@/components/common/Popup.vue';
import ValueInput from '@/components/common/ValueInput.vue';
import Dropdown from '@/components/common/Dropdown.vue';
import Checkbox from '@/components/common/Checkbox.vue';
import FlexButton from '@/components/common/FlexButton.vue';
import Icon from '@/components/common/Icon.vue';
import InventorySlot from '../basic/players/InventorySlot.vue';
import { useSpriteStore } from '@/stores/spriteStore';
import { useItemPresetsStore } from '@/stores/itemPresetsStore';
import { post } from '@/util/api';
import { PERMISSIONS } from '@/util/permissionValues';
import { similarity } from '@/util/fuzzyMatch';
import { BTN_VARIANT } from '@/util/constants';

/** Mirrors SNAPSHOT_GROUPS in the lambda's InventorySnapshots.ts. */
const GROUPS = [
	{ id: "core", label: "Inventory & equipment" },
	{ id: "storage", label: "Piggy bank, safe, forge, void vault" },
	{ id: "misc", label: "Trash & misc" },
	{ id: "loadouts", label: "Loadouts" },
];

/** Below this a query matches most of the item list, which is noise rather than a result set. */
const MIN_QUERY = 2;
/** Rendered results. The scoring runs over every item; only the top slice is worth drawing. */
const MAX_RESULTS = 40;
/** Same threshold FuzzyMatchSearch uses, since this reuses its scoring. */
const SCORE_THRESHOLD = 0.35;

export default {
	components: {
		Popup,
		ValueInput,
		Dropdown,
		Checkbox,
		FlexButton,
		Icon,
		InventorySlot,
	},
	props: {
		open: {
			type: Boolean,
			default: false
		},
		/** The stored rules, or null before they've been fetched. */
		rules: {
			type: [Object, null],
			default: null
		},
		disabled: {
			type: Boolean,
			default: false
		},
		loading: {
			type: Boolean,
			default: false
		}
	},
	emits: ['cancel', 'apply'],
	data() {
		return {
			BTN_VARIANT,
			GROUPS,
			MIN_QUERY,
			spriteStore: useSpriteStore(),
			presetsStore: useItemPresetsStore(),
			searchQuery: "",
			draftNetId: null,
			selectedPresetId: null,
			presetName: "",
			namingPreset: false,
			confirmingDelete: false,
			loadingPreset: false,
			savingPreset: false,
			deletingPreset: false,
			draft: {
				enabled: false,
				mode: "blacklist",
				groups: GROUPS.map(group => group.id),
				entries: [],
			},
		};
	},
	computed: {
		/**
		 * Mode and item count ride along in the label because a preset is chosen by name alone, and
		 * "Event rules" as a 12-item blacklist and as a 200-item whitelist are very different things.
		 */
		presetOptions() {
			return this.presetsStore.presets.map(preset => ({
				id: preset.presetId,
				text: `${preset.name} — ${preset.mode}, ${preset.itemCount} item${preset.itemCount === 1 ? '' : 's'}`,
			}));
		},
		selectedPresetName() {
			return this.presetsStore.getPreset(this.selectedPresetId)?.name || "";
		},
		/** One flag for every control in the bar, so a write in flight can't be raced by another. */
		presetsBusy() {
			return this.loadingPreset || this.savingPreset || this.deletingPreset || this.loading;
		},
		namesAvailable() {
			return this.spriteStore.hasNames;
		},
		/**
		 * The name map as a searchable array, built once per load rather than per keystroke — it is
		 * several thousand entries and the scoring below already walks all of them.
		 */
		searchable() {
			const names = this.spriteStore.names;
			if (!names) return [];
			return Object.entries(names).map(([netId, name]) => ({ netId: Number(netId), name }));
		},
		/**
		 * Substring matches first, fuzzy behind them.
		 *
		 * Reuses `similarity` (the same scoring FuzzyMatchSearch uses) rather than that component,
		 * because it owns its query internally and this needs the query to decide between "no search
		 * yet" and "searched, no matches" — two states that should not look the same.
		 */
		searchResults() {
			const query = this.searchQuery.trim().toLowerCase();
			if (query.length < MIN_QUERY || !this.searchable.length) {
				return [];
			}

			const scored = [];
			for (const item of this.searchable) {
				const name = item.name.toLowerCase();
				// An exact substring hit outranks everything; within those, the shorter name is the more
				// likely target ("Zenith" over "Zenith Trophy").
				const score = name.includes(query) ? 1 + 1 / name.length : similarity(query, name);
				if (score >= SCORE_THRESHOLD) {
					scored.push({ ...item, score });
				}
			}

			scored.sort((a, b) => b.score - a.score);
			return scored.slice(0, MAX_RESULTS);
		},
		modeOptions() {
			return [
				{ id: "blacklist", text: "Blacklist — flag listed items" },
				{ id: "whitelist", text: "Whitelist — flag everything else" },
			];
		},
		modeHint() {
			return this.draft.mode === "whitelist"
				? "Every item a player carries that is not on this list will be flagged. On a normal survival server that is most of what anyone holds."
				: "Only the items on this list will be flagged.";
		},
		popupButtons() {
			const buttons = [{ text: 'CANCEL', variant: BTN_VARIANT.DANGER, onClick: this.onCancel, disabled: this.loading }];
			if (!this.disabled) {
				buttons.push({ text: 'SAVE', variant: BTN_VARIANT.PRIMARY, onClick: this.onApply, loading: this.loading });
			}
			return buttons;
		},
	},
	methods: {
		/** The published map wins over the label stored with the entry — it is the same source, fresher. */
		displayName(entry) {
			return this.spriteStore.itemName(entry.netId) || entry.name || `Item #${entry.netId}`;
		},
		/** Shapes an entry like an inventory slot so InventorySlot can draw its sprite. */
		slotFor(entry) {
			return {
				netId: entry.netId,
				name: this.displayName(entry),
				stack: 1,
				prefix: 0,
				prefixName: null,
				favorited: false,
				slot: 0,
				globalSlot: 0,
			};
		},
		isListed(netId) {
			return this.draft.entries.some(entry => entry.netId === netId);
		},
		resetDraft() {
			this.draft = {
				enabled: Boolean(this.rules?.enabled),
				mode: this.rules?.mode || "blacklist",
				groups: this.rules?.groups?.length ? [...this.rules.groups] : GROUPS.map(group => group.id),
				// Copied rather than referenced: the draft is discarded on cancel, and mutating the store's
				// array in place would make cancel a no-op.
				entries: (this.rules?.entries || []).map(entry => ({ ...entry })),
			};
			this.draftNetId = null;
			this.searchQuery = "";
		},
		/**
		 * Clears the preset bar's transient state on open. Separate from `resetDraft` because that also
		 * runs whenever the stored rules change, and a re-fetch of the rules mid-edit should not close
		 * a name box the operator is typing into.
		 */
		resetPresetBar() {
			this.selectedPresetId = null;
			this.presetName = "";
			this.namingPreset = false;
			this.confirmingDelete = false;
		},
		toggleGroup(id, checked) {
			if (checked) {
				if (!this.draft.groups.includes(id)) this.draft.groups.push(id);
				return;
			}
			this.draft.groups = this.draft.groups.filter(group => group !== id);
		},
		/**
		 * Adds an id to the draft. The name is stored alongside it so a saved list stays readable even
		 * if the map is later unavailable — a copy of the same source, not a second source.
		 */
		add(netId, name) {
			if (this.isListed(netId)) return false;
			this.draft.entries.push({ netId, ...(name ? { name } : {}) });
			return true;
		},
		addFromSearch(result) {
			this.add(result.netId, result.name);
		},
		addById() {
			const netId = Number(this.draftNetId);
			// Zero is "no item"; negatives are real, and address Terraria's legacy item variants.
			if (!Number.isInteger(netId) || netId === 0) {
				this.$alert.error("Enter a whole item ID other than zero");
				return;
			}
			if (!this.add(netId, this.spriteStore.itemName(netId))) {
				this.$alert.warning(`Item ${netId} is already on the list`);
			}
			this.draftNetId = null;
		},
		removeEntry(netId) {
			this.draft.entries = this.draft.entries.filter(entry => entry.netId !== netId);
		},
		onCancel() {
			this.$emit('cancel');
		},
		onApply() {
			if (!this.draft.groups.length) {
				this.$alert.error("Pick at least one place to look");
				return;
			}
			if (this.draft.enabled && !this.draft.entries.length) {
				this.$alert.error("Add at least one item, or turn the check off");
				return;
			}

			this.$emit('apply', { ...this.draft, entries: this.draft.entries.map(entry => ({ ...entry })) });
		},

		/* ---- Presets ------------------------------------------------------------------------- */

		/**
		 * Fills the draft from a saved preset. Copies, never links — after this the server owns the
		 * list, and editing the preset later changes nothing here.
		 *
		 * `draft.enabled` is pointedly left alone: it is this server's operational switch, not part of
		 * the ruleset, and loading a list must not turn enforcement on or off underneath it.
		 */
		async onLoadPreset() {
			if (!this.selectedPresetId || this.presetsBusy) return;

			this.loadingPreset = true;
			try {
				const preset = await this.presetsStore.fetchPreset(this.selectedPresetId);
				if (!preset) return;

				this.draft.mode = preset.mode || "blacklist";
				this.draft.groups = preset.groups?.length ? [...preset.groups] : GROUPS.map(group => group.id);
				// Deep-copied for the same reason resetDraft does it: the store's copy must not be
				// mutated by editing the draft, or cancel stops being a cancel.
				this.draft.entries = (preset.entries || []).map(entry => ({ ...entry }));

				this.$alert.info(`Loaded preset “${preset.name}” — press SAVE to apply it to this server`);
			} catch (error) {
				this.$alert.error(error.message || "Failed to load preset");
			} finally {
				this.loadingPreset = false;
			}
		},
		/** The same guards `onApply` runs, so a preset can't be saved in a shape the server will reject. */
		draftIsSaveable() {
			if (!this.draft.groups.length) {
				this.$alert.error("Pick at least one place to look");
				return false;
			}
			if (!this.draft.entries.length) {
				this.$alert.error("Add at least one item before saving a preset");
				return false;
			}
			return true;
		},
		onSaveAsClicked() {
			if (!this.draftIsSaveable()) return;
			this.presetName = "";
			this.confirmingDelete = false;
			this.namingPreset = true;
		},
		/** `presetId` null saves a new preset; an id overwrites that one. */
		async onSavePreset(presetId) {
			if (this.presetsBusy) return;
			if (!this.draftIsSaveable()) return;

			const name = presetId ? this.selectedPresetName : this.presetName.trim();
			if (!name) {
				this.$alert.error("Give the preset a name");
				return;
			}

			try {
				this.$validatePermissions(PERMISSIONS.server.player.inventory.rules.write);
			} catch {
				return;
			}

			this.savingPreset = true;
			try {
				const data = await post('/system/items/presets', PERMISSIONS.server.player.inventory.rules.write, {
					...(presetId ? { presetId } : {}),
					name,
					mode: this.draft.mode,
					groups: this.draft.groups,
					entries: this.draft.entries,
				});

				this.namingPreset = false;
				this.presetName = "";
				this.presetsStore.invalidate(data.preset?.presetId ?? presetId);
				this.selectedPresetId = data.preset?.presetId ?? presetId;
				this.$alert.success(presetId ? `Preset “${name}” updated` : `Preset “${name}” saved`);
			} catch (error) {
				// Both of these are states the operator can act on, so they get the server's own wording
				// rather than a generic failure.
				if (error.code === "PRESET_NAME_TAKEN" || error.code === "PRESET_LIMIT_REACHED") {
					this.$alert.error(error.message);
				} else {
					this.$alert.error(error.message || "Failed to save preset");
				}
			} finally {
				this.savingPreset = false;
			}

			await this.refreshPresets();
		},
		async onDeletePreset() {
			if (!this.selectedPresetId || this.deletingPreset) return;

			try {
				this.$validatePermissions(PERMISSIONS.server.player.inventory.rules.write);
			} catch {
				return;
			}

			const deletedId = this.selectedPresetId;
			const deletedName = this.selectedPresetName;

			this.deletingPreset = true;
			try {
				await post(
					`/system/items/presets/${encodeURIComponent(deletedId)}/delete`,
					PERMISSIONS.server.player.inventory.rules.write,
					{}
				);

				this.presetsStore.invalidate(deletedId);
				this.selectedPresetId = null;
				this.confirmingDelete = false;
				this.$alert.success(`Preset “${deletedName}” deleted`);
			} catch (error) {
				this.$alert.error(error.message || "Failed to delete preset");
			} finally {
				this.deletingPreset = false;
			}

			await this.refreshPresets();
		},
		/** Re-reads the library after a write. Its own try/catch — a failed refresh isn't a failed write. */
		async refreshPresets() {
			try {
				await this.presetsStore.fetchPresets();
			} catch (error) {
				console.error(error);
			}
		},
	},
	watch: {
		rules() {
			this.resetDraft();
		},
		/** A confirm belongs to the preset it was opened on; switching the selection cancels it. */
		selectedPresetId() {
			this.confirmingDelete = false;
		},
		open(isOpen) {
			if (!isOpen) return;
			this.resetDraft();
			this.resetPresetBar();
			// Fetched on open rather than on mount: this is the only screen that needs the name map, and
			// it is a separate ~150KB object from the atlas. Both calls are idempotent.
			this.spriteStore.loadAtlas();
			this.spriteStore.loadItemNames();
			// Same reasoning for the preset library, and skipped entirely without write permission —
			// the bar it feeds is hidden in that case.
			if (!this.disabled) {
				this.refreshPresets();
			}
		},
	},
	mounted() {
		this.resetDraft();
	},
};
</script>

<style scoped>

</style>
