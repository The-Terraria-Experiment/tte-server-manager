<template>
	<div class="h-full w-full flex flex-col gap-3 min-w-0">
		<div class="p-2 bg-gray-4 rounded-xl">
			<div class="flex items-center justify-between mb-2">
				<div class="flex items-center">
					<Icon icon="gamepad" color="text-gray-6" size="5" />
					<p class="font-main font-bold text-gray-6 ml-2">INVENTORY</p>
				</div>
				<RefreshButton v-if="canRead && !playerLeft" :loading="loading" @input="loadInventory" />
			</div>

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

			<template v-if="canRead && inventory">
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2 font-main font-semibold">
					<p class="text-red-4">{{ inventory.stats.life }} / {{ inventory.stats.lifeMax }} HP</p>
					<p class="text-blue-2">{{ inventory.stats.mana }} / {{ inventory.stats.manaMax }} MP</p>
					<p v-if="inventory.serverSideCharacter" class="text-teal-4 text-sm">SSC</p>
					<p v-else class="text-gray-7 text-sm italic" title="Without server-side characters the client owns the inventory, so this is what the player reports.">Non-SSC</p>
				</div>

				<div v-if="inventory.buffs?.length" class="flex flex-wrap gap-1 px-1 pb-2">
					<div
						v-for="buff in inventory.buffs"
						:key="buff.id"
						class="px-2 py-0.5 bg-gray-3 rounded text-xs font-main font-semibold text-teal-6"
						:title="`Buff ID ${buff.id}`"
					>
						{{ buff.name }}<span class="text-gray-7 ml-1">{{ buffTime(buff) }}</span>
					</div>
				</div>

				<!-- Core: the arrangement the player actually sees in game. -->
				<div class="flex flex-wrap gap-4 px-1 pb-1">
					<div>
						<p class="font-main text-xs text-gray-7 mb-1">MAIN</p>
						<div class="flex flex-col gap-1">
							<div v-for="row in 5" :key="`main-${row}`" class="flex gap-1">
								<InventorySlot
									v-for="col in 10"
									:key="`main-${row}-${col}`"
									:item="itemAt('Inventory', (row - 1) * 10 + (col - 1))"
									:size="slotSize"
								/>
							</div>
						</div>

						<div class="flex gap-4 mt-2">
							<div>
								<p class="font-main text-xs text-gray-7 mb-1">COINS</p>
								<div class="flex gap-1">
									<InventorySlot v-for="i in 4" :key="`coin-${i}`" :item="itemAt('Inventory', 49 + i)" :size="slotSize" :label="`Coin ${i}`" />
								</div>
							</div>
							<div>
								<p class="font-main text-xs text-gray-7 mb-1">AMMO</p>
								<div class="flex gap-1">
									<InventorySlot v-for="i in 4" :key="`ammo-${i}`" :item="itemAt('Inventory', 53 + i)" :size="slotSize" :label="`Ammo ${i}`" />
								</div>
							</div>
							<div>
								<p class="font-main text-xs text-gray-7 mb-1">CURSOR</p>
								<InventorySlot :item="itemAt('Inventory', 58)" :size="slotSize" label="Held by cursor" />
							</div>
						</div>
					</div>

					<!--
						Equipment is three columns by ten rows, exactly as in game: worn item, its vanity
						counterpart, its dye. The Armor container packs those as 0-9 worn (helm, chest,
						legs, then 7 accessories) and 10-19 vanity, so a row is [i, i+10] plus dye i.
					-->
					<div>
						<p class="font-main text-xs text-gray-7 mb-1">EQUIPPED / VANITY / DYE</p>
						<div class="flex flex-col gap-1">
							<div v-for="i in 10" :key="`eq-${i}`" class="flex gap-1">
								<InventorySlot :item="itemAt('Armor', i - 1)" :size="slotSize" :label="armorLabel(i - 1)" />
								<InventorySlot :item="itemAt('Armor', i + 9)" :size="slotSize" :label="`Vanity ${armorLabel(i - 1)}`" />
								<InventorySlot :item="itemAt('Dyes', i - 1)" :size="slotSize" label="Dye" />
							</div>
						</div>
					</div>

					<div>
						<p class="font-main text-xs text-gray-7 mb-1">EQUIPMENT</p>
						<div class="flex flex-col gap-1">
							<div v-for="i in 5" :key="`misc-${i}`" class="flex gap-1">
								<InventorySlot :item="itemAt('MiscEquips', i - 1)" :size="slotSize" :label="MISC_LABELS[i - 1]" />
								<InventorySlot :item="itemAt('MiscDyes', i - 1)" :size="slotSize" :label="`${MISC_LABELS[i - 1]} dye`" />
							</div>
						</div>
					</div>
				</div>
			</template>
		</div>

		<!--
			Storage and loadouts are collapsed by default. 350 slots do not fit alongside the manage
			panel, and these are empty for most players -- the item counts in the headers mean an
			interesting one still announces itself without being expanded.
		-->
		<template v-if="inventory">
			<div v-for="section in sections" :key="section.name" class="bg-gray-4 rounded-xl">
				<div
					class="flex items-center p-2 cursor-pointer select-none"
					@click="toggle(section.name)"
				>
					<Icon
						icon="caret-down"
						color="text-gray-6"
						size="4"
						class="transition-transform duration-100"
						:class="open[section.name] ? '' : '-rotate-90'"
					/>
					<p class="font-main font-bold text-gray-6 ml-2">{{ section.name.toUpperCase() }}</p>
					<p class="font-main text-sm ml-auto" :class="section.count ? 'text-teal-5' : 'text-gray-7'">
						{{ section.count }} item{{ plural(section.count) }}
					</p>
				</div>

				<div v-if="open[section.name]" class="flex flex-wrap gap-4 px-3 pb-3">
					<div v-for="group in section.groups" :key="group.title">
						<p class="font-main text-xs text-gray-7 mb-1">{{ group.title }}</p>
						<div class="flex flex-col gap-1">
							<div v-for="row in group.rows" :key="`${group.title}-${row}`" class="flex gap-1">
								<InventorySlot
									v-for="col in Math.min(group.columns, group.size - (row - 1) * group.columns)"
									:key="`${group.title}-${row}-${col}`"
									:item="itemAt(group.container, (row - 1) * group.columns + (col - 1))"
									:size="slotSize"
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</template>
	</div>
</template>

<script>
import { useServerStore } from '../../../../../../stores/serverStore';
import { useSpriteStore } from '../../../../../../stores/spriteStore';
import { PERMISSIONS } from '../../../../../../util/permissionValues';
import { plural } from '../../../../../../util/format';
import Icon from '../../../../../common/Icon.vue';
import RefreshButton from '../../../../../common/RefreshButton.vue';
import InventorySlot from './InventorySlot.vue';

/** Worn-equipment slot names, in the Armor container's own order. */
const ARMOR_LABELS = ["Helmet", "Chestplate", "Leggings"];
const MISC_LABELS = ["Pet", "Light Pet", "Minecart", "Mount", "Grappling Hook"];

export default {
	components: {
		Icon,
		RefreshButton,
		InventorySlot,
	},
	props: {
		selectedPlayer: {
			type: Object,
			default: null,
		},
	},
	data() {
		return {
			PERMISSIONS,
			MISC_LABELS,
			serverStore: useServerStore(),
			spriteStore: useSpriteStore(),
			slotSize: 34,
			error: "",
			/** Last inventory this popup held for the current player — see the `inventory` computed. */
			retained: null,
			open: {
				Storage: false,
				Loadouts: false,
			},
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
		/** Containers keyed by name, so a grid can look one up without scanning the array each cell. */
		containers() {
			const byName = {};
			for (const container of this.inventory?.containers ?? []) {
				byName[container.name] = container;
			}
			return byName;
		},
		sections() {
			const storageGroups = [
				{ title: "PIGGY BANK", container: "PiggyBank", size: 40, columns: 10 },
				{ title: "SAFE", container: "Safe", size: 40, columns: 10 },
				{ title: "DEFENDER'S FORGE", container: "Forge", size: 40, columns: 10 },
				{ title: "VOID VAULT", container: "VoidVault", size: 40, columns: 10 },
				{ title: "TRASH", container: "Trash", size: 1, columns: 1 },
			];

			const loadoutGroups = [1, 2, 3].flatMap(n => [
				{ title: `LOADOUT ${n} — EQUIPPED`, container: `Loadout${n}Armor`, size: 20, columns: 10 },
				{ title: `LOADOUT ${n} — DYES`, container: `Loadout${n}Dyes`, size: 10, columns: 10 },
			]);

			const build = (name, groups) => ({
				name,
				groups: groups.map(group => ({ ...group, rows: Math.ceil(group.size / group.columns) })),
				count: groups.reduce((total, group) => total + (this.containers[group.container]?.items?.length ?? 0), 0),
			});

			return [build("Storage", storageGroups), build("Loadouts", loadoutGroups)];
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
		plural,
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
		/** The item in a container's local slot index, or null. The plugin reports occupied slots only. */
		itemAt(containerName, index) {
			const container = this.containers[containerName];
			if (!container) {
				return null;
			}
			return container.items.find(item => item.slot === index) ?? null;
		},
		armorLabel(index) {
			return ARMOR_LABELS[index] ?? `Accessory ${index - 2}`;
		},
		buffTime(buff) {
			if (!buff.secondsRemaining || buff.secondsRemaining < 0) {
				return "";
			}
			const minutes = Math.floor(buff.secondsRemaining / 60);
			const seconds = buff.secondsRemaining % 60;
			return `${minutes}:${String(seconds).padStart(2, "0")}`;
		},
		toggle(name) {
			this.open[name] = !this.open[name];
		},
	},
};
</script>

<style scoped>
</style>
