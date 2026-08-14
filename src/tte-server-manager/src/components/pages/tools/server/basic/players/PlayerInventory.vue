<template>
	<InventoryGrid :inventory="inventory" :flagged-slots="flaggedSlots" :slot-size="slotSize">
		<template #header>
			<div class="flex items-center justify-between mb-2">
				<div class="flex items-center">
					<Icon icon="gamepad" color="text-gray-6" size="5" />
					<p class="font-main font-bold text-gray-6 ml-2">INVENTORY</p>
				</div>
				<RefreshButton v-if="canRead && !playerLeft" :loading="loading" @input="loadInventory" />
			</div>
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
import Icon from '../../../../../common/Icon.vue';
import RefreshButton from '../../../../../common/RefreshButton.vue';
import InventoryGrid from './InventoryGrid.vue';

/**
 * The live inventory of a player who is online right now.
 *
 * Everything about *rendering* an inventory lives in `InventoryGrid.vue`; this component owns the
 * store wiring, the permission and error states, and the rules about when a read is worth paying
 * for. The archived-snapshot browser shares the grid and none of the rest, which is the split that
 * keeps a live inventory and a months-old one drawing identically.
 */
export default {
	components: {
		Icon,
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
			serverStore: useServerStore(),
			spriteStore: useSpriteStore(),
			slotSize: 34,
			error: "",
			/** Last inventory this popup held for the current player — see the `inventory` computed. */
			retained: null,
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
	},
	watch: {
		playerName: {
			immediate: true,
			handler(name) {
				// The retained copy belongs to the previous player — keeping it would render their
				// inventory under this player's name.
				this.retained = null;
				this.error = "";
				if (name) {
					this.loadInventory();
				}
			},
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
