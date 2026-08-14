<template>
	<InventoryGrid
		:inventory="inventory"
		:flagged-slots="flaggedSlots"
		:slot-size="slotSize"
		:selectable="editing"
		:selected-slots="selectedSlots"
		@select="toggleSlot"
	>
		<template #header>
			<div class="flex items-center justify-between mb-2">
				<div class="flex items-center self-start mx-2 my-1">
					<!-- <Icon icon="gamepad" color="text-gray-6" size="5" class="mr-2" /> -->
					<p class="font-main font-bold text-gray-6">INVENTORY</p>
				</div>
				<div class="flex items-center gap-2">
					<FlexButton v-if="canEdit" :variant="BTN_VARIANT.SECONDARY" @input="toggleEditing">
						<p class="font-main font-bold" :class="'text-teal-3'">
							{{ editing ? "DONE" : "REMOVE ITEMS" }}
						</p>
					</FlexButton>
					<RefreshButton v-if="canRead && !playerLeft" :loading="loading" @input="loadInventory" />
				</div>
			</div>

			<!--
				The editing toolbar. Kept in the header slot rather than inside InventoryGrid so the grid
				stays presentational and the snapshot browser, which shares it, never renders any of this.
			-->
			<div v-if="editing" class="flex flex-wrap items-center gap-2 mb-2 px-2 py-2 bg-gray-3 rounded-lg border border-gray-5">
				<p class="font-main font-bold text-sm" :class="selectionCount ? 'text-teal-4' : 'text-gray-7'">
					{{ selectionCount }} SELECTED
				</p>

				<FlexButton
					v-if="flaggedNetIds.size"
					:variant="BTN_VARIANT.SECONDARY"
					:disabled="busy"
					@input="selectFlagged"
				>
					<p class="font-main font-bold text-sm py-1 px-3 text-teal-3">SELECT FLAGGED</p>
				</FlexButton>

				<FlexButton v-if="selectionCount" :variant="BTN_VARIANT.SUBTLE" :disabled="busy" @input="clearSelection">
					<p class="font-main font-bold text-sm py-1 px-3 text-gray-8 cursor-pointer">DESELECT ALL</p>
				</FlexButton>

				<div class="ml-auto flex items-center gap-2">
					<FlexButton
						:variant="BTN_VARIANT.DANGER"
						:disabled="!selectionCount || busy"
						@input="confirmRemoveSelected"
					>
						<p class="font-main font-bold text-sm py-1 px-3">REMOVE SELECTED</p>
					</FlexButton>
					<FlexButton :variant="BTN_VARIANT.DANGER" :disabled="busy" @input="confirmClearAll">
						<p class="font-main font-bold text-sm py-1 px-3">WIPE EVERYTHING</p>
					</FlexButton>
				</div>
			</div>

			<!--
				Inline confirmation rather than a modal: the operator needs to keep seeing the grid they
				selected from while deciding, and this app puts progress and confirmation for mutating
				actions inline everywhere else.
			-->
			<div v-if="pending" class="mb-2 px-3 py-2 bg-gray-3 rounded-lg border border-red-5">
				<p class="font-main font-bold text-red-4">{{ pending.label }}</p>
				<p class="font-main text-sm text-gray-7 mt-0.5">
					This destroys the items outright. There is no undo, and nothing is refunded to the player.
				</p>
				<div class="flex items-center gap-2 mt-2">
					<FlexButton :variant="BTN_VARIANT.DANGER" :loading="busy" :disabled="busy" @input="runPending">
						<p class="font-main font-bold text-sm py-1 px-3">{{ busy ? "REMOVING…" : "CONFIRM" }}</p>
					</FlexButton>
					<FlexButton :variant="BTN_VARIANT.SUBTLE" :disabled="busy" @input="pending = null">
						<p class="font-main font-bold text-sm py-1 px-3 text-gray-6">CANCEL</p>
					</FlexButton>
				</div>
			</div>
		</template>

		<!--
			One clear button per container block. The grid supplies the occupied global slots for each
			block; what "clear" means stays here.
		-->
		<template v-if="editing" #container-actions="{ title, globalSlots }">
			<button
				v-if="globalSlots.length"
				class="font-main font-bold text-xs text-red-4 hover:text-red-3 px-1.5 py-0.5 rounded border border-red-5 leading-none"
				:disabled="busy"
				@click="confirmClearContainer(title, globalSlots)"
			>CLEAR</button>
		</template>

		<template #status>
			<!-- Not-permitted, error and empty states are all distinct: the fixes differ. -->
			<p v-if="!canRead" class="font-main text-gray-7 italic px-1 py-2">
				You do not have permission to view player inventories.
			</p>

			<template v-else>
				<!-- Not an error: the read is simply no longer possible, and what is on screen is final. -->
				<p v-if="playerLeft" class="font-main text-gray-7 italic px-1 py-2">
					{{ playerName }} is no longer online{{ inventory ? " — this is the last inventory read" : "" }}.
				</p>
				<!--
					Deliberately not exclusive with the grid below: a refresh that fails should not blank
					out the inventory the user is looking at. The stale data is still the best thing on
					screen, so the error sits above it rather than replacing it.
				-->
				<p v-if="error" class="font-main text-red-5 px-1 py-2">{{ error }}</p>

				<!--
					The result of the last removal. Every line here is something the operator has to act
					on, which is why a partial result is a success carrying detail rather than an error:
					"3 of 5 removed" with no word on the other two is the one answer that would leave them
					unable to finish the job.
				-->
				<div v-if="outcome" class="px-1 py-2 flex flex-col gap-0.5">
					<p class="font-main text-teal-4">{{ outcomeSummary }}</p>
					<p v-if="outcome.skippedChanged?.length" class="font-main text-sm text-yellow-1">
						{{ outcome.skippedChanged.length }} slot{{ plural(outcome.skippedChanged.length) }} changed since you
						looked and {{ outcome.skippedChanged.length === 1 ? "was" : "were" }} left alone — refresh and reselect.
					</p>
					<p v-if="outcome.skippedEmpty?.length" class="font-main text-sm text-gray-7">
						{{ outcome.skippedEmpty.length }} slot{{ plural(outcome.skippedEmpty.length) }}
						{{ outcome.skippedEmpty.length === 1 ? "was" : "were" }} already empty.
					</p>
					<p v-if="outcome.truncated" class="font-main text-sm text-yellow-1">
						Stopped at the time limit with items left — remove the rest in another pass.
					</p>
					<p v-if="outcome.unreachable" class="font-main text-sm text-red-5">
						The server stopped responding partway through; the remaining items were not attempted.
					</p>
					<p v-for="failure in outcome.failed ?? []" :key="failure.globalSlot" class="font-main text-sm text-red-5">
						Slot {{ failure.globalSlot }} failed: {{ failure.error }}
					</p>
					<p class="font-main text-xs text-gray-7 italic mt-0.5">
						Without server-side characters the client owns its inventory, so a determined cheat client
						can put an item back. This shows a fresh read taken after the removal.
					</p>
				</div>

				<p v-if="loading && !inventory" class="font-main text-gray-7 italic px-1 py-2">Reading inventory…</p>
				<p v-else-if="!inventory && !error && !playerLeft" class="font-main text-gray-7 italic px-1 py-2">No inventory loaded.</p>
			</template>
		</template>
	</InventoryGrid>
</template>

<script>
import { useServerStore } from '../../../../../../stores/serverStore';
import { useSpriteStore } from '../../../../../../stores/spriteStore';
import { PERMISSIONS } from '../../../../../../util/permissionValues';
import { BTN_VARIANT } from '../../../../../../util/constants';
import { plural } from '../../../../../../util/format';
import Icon from '../../../../../common/Icon.vue';
import FlexButton from '../../../../../common/FlexButton.vue';
import RefreshButton from '../../../../../common/RefreshButton.vue';
import InventoryGrid from './InventoryGrid.vue';

/**
 * The live inventory of a player who is online right now.
 *
 * Everything about *rendering* an inventory lives in `InventoryGrid.vue`; this component owns the
 * store wiring, the permission and error states, and the rules about when a read is worth paying
 * for. The archived-snapshot browser shares the grid and none of the rest, which is the split that
 * keeps a live inventory and a months-old one drawing identically.
 *
 * It also owns **removal** — the moderation half, behind `server.player.inventory.write`. That is
 * destroy-only by design: there is no path here, and none in the plugin, that adds or alters an item.
 * All of it is staged locally and sent in one request on confirmation, so nothing is destroyed by a
 * single mis-click, and the grid it renders afterwards is a fresh read from the server rather than an
 * optimistic local edit — see the store action for why that distinction matters on a non-SSC server.
 */
export default {
	components: {
		Icon,
		FlexButton,
		RefreshButton,
		InventoryGrid,
	},
	props: {
		selectedPlayer: {
			type: Object,
			default: null,
		},
		/**
		 * This player's latest item-rule violation, or null. Passed in rather than read from the store
		 * here because Players.vue already resolves it for the roster marker, and one lookup keeps the
		 * marker and the rings from ever disagreeing.
		 */
		violation: {
			type: [Object, null],
			default: null,
		},
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			spriteStore: useSpriteStore(),
			slotSize: 34,
			error: "",
			/** Last inventory this popup held for the current player — see the `inventory` computed. */
			retained: null,
			/**
			 * Removal mode. Off by default and never sticky across players: arriving at a new player
			 * already armed to destroy their items is the wrong default for a destructive tool.
			 */
			editing: false,
			/**
			 * Slots marked for removal, keyed by `globalSlot`, holding the item that was in them when
			 * the operator clicked. The `netId` travels with the request so the backend can refuse a
			 * slot whose contents changed in the meantime.
			 */
			selection: {},
			/** The confirmation currently on screen: `{ label, payload }`, or null. */
			pending: null,
			busy: false,
			/** Result of the last removal, rendered in the status slot. */
			outcome: null,
		};
	},
	computed: {
		canRead() {
			return this.$checkPermissions(PERMISSIONS.server.player.inventory.read);
		},
		playerName() {
			return this.selectedPlayer?.nickname ?? null;
		},
		instanceID() {
			return this.serverStore.selectedInstanceID;
		},
		storeInventory() {
			if (!this.playerName) {
				return null;
			}
			return this.serverStore.getPlayerInventory(this.instanceID, this.playerName);
		},
		/**
		 * What the grid renders. Falls back to the copy this popup was last given, because the store
		 * evicts a player's inventory when they leave the roster — and someone reading an inventory at
		 * the moment its owner logs off is exactly the person who needs it to stay on screen. Same
		 * reasoning as leaving stale contents up when a refresh fails.
		 */
		inventory() {
			return this.storeInventory ?? this.retained;
		},
		/**
		 * Nicknames currently online, or null when there is no roster information at all (server off,
		 * status read failed, page not loaded yet). Null and empty mean different things here.
		 */
		roster() {
			const players = this.serverStore.selectedServerData.players;
			return Array.isArray(players) ? players.map(player => player.nickname) : null;
		},
		/**
		 * The roster reduced to something a watcher can compare by value. Watching the array itself
		 * would fire on every `fetchServerStatus` — it replaces the array wholesale, and both the
		 * pollers and every socket event call it — so each status refresh would cost an inventory read
		 * through tshock-proxy to the game server. Only a change in membership should cost a request.
		 */
		rosterKey() {
			return this.roster ? JSON.stringify([...this.roster].sort()) : null;
		},
		/** The viewed player has gone offline, so there is nothing left to read. */
		playerLeft() {
			return Boolean(this.playerName && this.roster && !this.roster.includes(this.playerName));
		},
		loading() {
			if (!this.playerName) {
				return false;
			}
			return this.serverStore.isLoadingInventory(this.instanceID, this.playerName);
		},
		/** Flagged positions as `container::slot`, for the ring on the grid. */
		flaggedSlots() {
			const flagged = new Set();
			for (const item of this.violation?.items ?? []) {
				flagged.add(`${item.container}::${item.slot}`);
			}
			return flagged;
		},
		canWrite() {
			return this.$checkPermissions(PERMISSIONS.server.player.inventory.write);
		},
		/** Removal needs the permission, an inventory to act on, and a player still online to act against. */
		canEdit() {
			return Boolean(this.canWrite && this.inventory && !this.playerLeft);
		},
		selectedSlots() {
			return new Set(Object.keys(this.selection).map(Number));
		},
		selectionCount() {
			return Object.keys(this.selection).length;
		},
		/**
		 * Item ids from this player's violation, for SELECT FLAGGED.
		 *
		 * Matched by `netId` rather than by the violation's stored `globalSlot` deliberately. A
		 * violation is captured from a *join* snapshot, so its slot indices describe where the items sat
		 * the moment the player connected — by the time anyone acts on it they have usually moved. Slot
		 * matching would quietly select the wrong squares, and the backend's stale-slot check would then
		 * refuse the removal for reasons the operator could not make sense of.
		 */
		flaggedNetIds() {
			return new Set((this.violation?.items ?? []).map(item => item.netId));
		},
		outcomeSummary() {
			if (!this.outcome) {
				return "";
			}
			if (this.outcome.op === "clear") {
				return `Cleared ${this.outcome.slotsCleared} slot${plural(this.outcome.slotsCleared)}.`;
			}
			const count = this.outcome.removed?.length ?? 0;
			return `Destroyed ${count} item${plural(count)}.`;
		},
	},
	watch: {
		playerName: {
			immediate: true,
			handler(name) {
				// The retained copy belongs to the previous player — keeping it would render their
				// inventory under this player's name. The selection is worse: those slot numbers would
				// still be valid against the new player, so a stale one is a request to destroy items
				// belonging to someone the operator never looked at.
				this.retained = null;
				this.error = "";
				this.exitEditing();
				if (name) {
					this.loadInventory();
				}
			},
		},
		/**
		 * A player who logs off mid-edit takes the whole feature with them — every plugin endpoint but
		 * `itemnames` needs them online, so a pending confirmation would only ever produce an error.
		 */
		playerLeft(left) {
			if (left) {
				this.exitEditing();
			}
		},
		storeInventory(next) {
			if (next) {
				this.retained = next;
			}
		},
		/**
		 * Someone joined or left. That is the only live signal this app has that the server moved, and
		 * it now arrives within about a second via the socket, so it is what keeps an open inventory
		 * current — the plugin reports live state, and an inventory read minutes ago is the failure
		 * mode worth avoiding when the point of reading it is to check for cheated items.
		 *
		 * Note there is nothing socket-specific here. `server.players` makes realtimeStore call
		 * `fetchServerStatus`, which writes the roster, which fires this watcher; a poller tick or a
		 * manual refresh reaches it by exactly the same route.
		 */
		rosterKey(next, previous) {
			// A roster appearing or disappearing is the server starting or stopping, not a membership
			// change, and there is nothing useful to read in either direction.
			if (next === null || previous === null) return;
			if (this.playerLeft) return;
			this.loadInventory();
		},
	},
	created() {
		// Kicked off here rather than on first render so the map is usually in hand by the time the
		// grid paints. Idempotent, so every mounted inventory calling it costs one request in total.
		this.spriteStore.loadAtlas();
	},
	methods: {
		plural,
		toggleEditing() {
			if (this.editing) {
				this.exitEditing();
				return;
			}
			this.editing = true;
			this.outcome = null;
		},
		/** Leaves removal mode and drops everything staged in it. Used by the toggle and by both watchers. */
		exitEditing() {
			this.editing = false;
			this.selection = {};
			this.pending = null;
			this.outcome = null;
		},
		toggleSlot(item) {
			if (this.selection[item.globalSlot]) {
				delete this.selection[item.globalSlot];
				return;
			}
			this.selection[item.globalSlot] = {
				globalSlot: item.globalSlot,
				netId: item.netId,
				name: item.name,
			};
		},
		clearSelection() {
			this.selection = {};
		},
		/** Selects every live slot holding an item this player was flagged for. */
		selectFlagged() {
			for (const container of this.inventory?.containers ?? []) {
				for (const item of container.items) {
					if (this.flaggedNetIds.has(item.netId)) {
						this.selection[item.globalSlot] = {
							globalSlot: item.globalSlot,
							netId: item.netId,
							name: item.name,
						};
					}
				}
			}
		},
		/** Every occupied slot, keyed by global index — used to attach `netId` to a container clear. */
		itemsByGlobalSlot() {
			const bySlot = {};
			for (const container of this.inventory?.containers ?? []) {
				for (const item of container.items) {
					bySlot[item.globalSlot] = item;
				}
			}
			return bySlot;
		},
		confirmRemoveSelected() {
			const slots = Object.values(this.selection).map(({ globalSlot, netId }) => ({ globalSlot, netId }));
			this.pending = {
				label: `Destroy ${slots.length} item${plural(slots.length)} from ${this.playerName}?`,
				payload: { op: "remove-slots", slots },
			};
		},
		/**
		 * Clears one container block. Sent as an explicit slot list carrying `netId` rather than as the
		 * plugin's `clear` scope, because the plugin's scopes are group-wide (`storage` is every
		 * storage container at once) and cannot address a single container — and because going through
		 * the slot path keeps the stale-slot check in play.
		 */
		confirmClearContainer(title, globalSlots) {
			const bySlot = this.itemsByGlobalSlot();
			const slots = globalSlots
				.filter(globalSlot => bySlot[globalSlot])
				.map(globalSlot => ({ globalSlot, netId: bySlot[globalSlot].netId }));

			this.pending = {
				label: `Destroy all ${slots.length} item${plural(slots.length)} in ${title} from ${this.playerName}?`,
				payload: { op: "remove-slots", slots },
			};
		},
		/**
		 * The one path that uses the plugin's own `clear`: it empties everything in a single REST call,
		 * where the equivalent slot list would be hundreds of round trips and would hit the request
		 * budget on exactly the action an operator wants to be immediate.
		 */
		confirmClearAll() {
			this.pending = {
				label: `Destroy everything ${this.playerName} is carrying, including storage and loadouts?`,
				payload: { op: "clear", scope: "all" },
			};
		},
		async runPending() {
			if (!this.pending || this.busy) {
				return;
			}

			this.busy = true;
			this.error = "";
			this.outcome = null;

			try {
				const outcome = await this.serverStore.editPlayerInventory(this.instanceID, this.playerName, this.pending.payload);
				this.outcome = outcome;
				this.pending = null;
				// The removed slots are gone and the skipped ones are stale by definition, so nothing in
				// the old selection still describes something worth acting on.
				this.selection = {};
			} catch (e) {
				// Inline, like every other failure in this popup. An $alert.error would be sticky and
				// would sit over the grid the operator needs to see to work out what happened.
				this.error = e?.message || "Failed to remove the player's items";
			} finally {
				this.busy = false;
			}
		},
		async loadInventory() {
			// playerLeft guards the manual refresh too: the plugin has nothing to report for an offline
			// player, and readPlayerInventory turns an empty report into a 502 that names the plugin as
			// the likely cause — an error about the wrong thing entirely.
			if (!this.canRead || !this.playerName || !this.instanceID || this.playerLeft) {
				return;
			}

			this.error = "";
			try {
				await this.serverStore.fetchPlayerInventory(this.instanceID, this.playerName);
			} catch (e) {
				// Shown inline instead of as an alert: the popup is where the user is looking, and the
				// actionable cases (plugin missing, REST permission missing, server down) all name a fix.
				this.error = e?.message || "Failed to read the player's inventory";
			}
		},
	},
};
</script>

<style scoped>
</style>
