<template>
	<div class="h-full w-full flex flex-col gap-2 min-w-0">
		<div class="p-2 bg-gray-2 rounded-xl border border-gray-5">
			<slot name="header" />
			<slot name="status" />

			<template v-if="inventory">
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
					<div class="max-w-full">
						<p class="font-main text-xs text-gray-7 mb-1">MAIN</p>
						<div class="flex flex-col gap-1 max-w-full overflow-x-auto">
							<div v-for="row in 5" :key="`main-${row}`" class="flex gap-1">
								<InventorySlot
									v-for="col in 10"
									:key="`main-${row}-${col}`"
									:item="itemAt('Inventory', (row - 1) * 10 + (col - 1))"
									:size="slotSize"
								/>
							</div>
						</div>

						<div class="flex gap-4 mt-2 max-w-full overflow-x-auto">
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
					<div class="max-w-full overflow-x-auto">
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
			<div v-for="section in sections" :key="section.name" class="bg-gray-2 rounded-xl border border-gray-5">
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
					<div v-for="group in section.groups" :key="group.title" class="max-w-full">
						<p class="font-main text-xs text-gray-7 mb-1">{{ group.title }}</p>
						<div class="flex flex-col gap-1 max-w-full overflow-x-auto">
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
import { plural } from '../../../../../../util/format';
import Icon from '../../../../../common/Icon.vue';
import InventorySlot from './InventorySlot.vue';

/** Worn-equipment slot names, in the Armor container's own order. */
const ARMOR_LABELS = ["Helmet", "Chestplate", "Leggings"];
const MISC_LABELS = ["Pet", "Light Pet", "Minecart", "Mount", "Grappling Hook"];

/**
 * Renders one inventory report — the 350-slot grid, exactly as the player sees it in game.
 *
 * Purely presentational, and that is the point: two callers now hand it a report from completely
 * different places. `PlayerInventory.vue` reads a live one off the InventoryMonitor plugin through
 * the store; `InventorySnapshots.vue` reads an archived one out of S3, possibly months old. Keeping
 * one renderer is what stops the two disagreeing about which square a slot index means — a
 * discrepancy would show up as a violation highlighting the wrong item, which is the failure mode
 * hardest to notice and worst to get wrong.
 *
 * It owns no fetching, no permissions and no error states. The header and status slots exist so the
 * caller can put its own controls and messages inside the tile without this component knowing what
 * they are.
 */
export default {
	components: {
		Icon,
		InventorySlot,
	},
	props: {
		/** A normalized inventory report, or null to render the empty frame. */
		inventory: {
			type: [Object, null],
			default: null,
		},
		/**
		 * Positions to ring, as `container::slot`. Matched on position rather than item id so only the
		 * offending copy lights up — a player carrying a banned item in the piggy bank and a permitted
		 * one in the main grid should not have both marked.
		 */
		flaggedSlots: {
			type: Set,
			default: () => new Set(),
		},
		slotSize: {
			type: Number,
			default: 34,
		},
	},
	data() {
		return {
			MISC_LABELS,
			open: {
				Storage: false,
				Loadouts: false,
			},
		};
	},
	computed: {
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
	methods: {
		plural,
		/**
		 * The item in a container's local slot index, or null. The plugin reports occupied slots only.
		 *
		 * Marks a rule violation here rather than at every one of the ~20 grid call sites, and on a copy
		 * rather than the object itself — the item belongs to the store, and writing a display flag onto
		 * it would leak into every other reader of that inventory.
		 */
		itemAt(containerName, index) {
			const container = this.containers[containerName];
			if (!container) {
				return null;
			}

			const item = container.items.find(entry => entry.slot === index) ?? null;
			if (!item || !this.flaggedSlots.has(`${containerName}::${index}`)) {
				return item;
			}
			return { ...item, flagged: true };
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
