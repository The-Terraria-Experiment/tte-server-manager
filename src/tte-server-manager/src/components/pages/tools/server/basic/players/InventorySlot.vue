<template>
	<div
		class="relative shrink-0 rounded border flex items-center justify-center select-none"
		:class="[
			item ? 'bg-gray-3 border-gray-5' : 'bg-gray-2 border-gray-3',
			item?.favorited ? 'ring-1 ring-yellow-1' : ''
		]"
		:style="{ width: `${size}px`, height: `${size}px` }"
		:title="hoverText"
	>
		<!-- The sprite is a window onto the shared atlas, so a full inventory costs no extra requests. -->
		<div v-if="spriteStyle" class="sprite" :style="spriteStyle"></div>

		<!--
			No sprite: either the atlas isn't published/loaded, or this ID is newer than the atlas
			(a Terraria update adds items long before we re-rip). Both must stay legible rather than
			showing a broken image, so fall back to the name the plugin already gave us.
		-->
		<p
			v-else-if="item"
			class="px-0.5 text-center leading-none font-main font-semibold text-gray-8 break-all overflow-hidden"
			:style="{ fontSize: `${Math.max(6, Math.round(size / 5))}px`, maxHeight: `${size}px` }"
		>{{ fallbackLabel }}</p>

		<p
			v-if="item && item.stack > 1"
			class="absolute bottom-0 right-0.5 font-main font-bold text-white-1 leading-none pointer-events-none"
			:style="{ fontSize: `${Math.max(8, Math.round(size / 3.6))}px`, textShadow: '0 1px 2px #000, 0 0 2px #000' }"
		>{{ item.stack }}</p>

		<!-- A modifier is the single most useful cheat signal on a slot, so it gets a visible mark. -->
		<div v-if="item?.prefixName" class="absolute top-0.5 left-0.5 h-1 w-1 rounded-full bg-teal-5 pointer-events-none"></div>
	</div>
</template>

<script>
import { useSpriteStore } from '../../../../../../stores/spriteStore';

export default {
	props: {
		/**
		 * A slot entry from the InventoryMonitor report, or null for an empty slot. The plugin only
		 * reports occupied slots, so the parent builds fixed-size grids and passes null for the rest.
		 */
		item: {
			type: Object,
			default: null,
		},
		size: {
			type: Number,
			default: 34,
		},
		/** Shown in the tooltip so a slot can be named ("Helmet", "Coin 1") rather than just numbered. */
		label: {
			type: String,
			default: "",
		},
	},
	data() {
		return {
			spriteStore: useSpriteStore(),
		};
	},
	computed: {
		spriteStyle() {
			if (!this.item) {
				return null;
			}
			// Sized to the slot's interior so a large sprite scales down instead of overflowing.
			return this.spriteStore.spriteStyle(this.item.netId, this.size - 4);
		},
		fallbackLabel() {
			if (!this.item) {
				return "";
			}
			return this.item.name || `#${this.item.netId}`;
		},
		hoverText() {
			if (!this.item) {
				return this.label;
			}

			const lines = [
				this.item.prefixName ? `${this.item.prefixName} ${this.item.name}` : this.item.name,
				`ID ${this.item.netId}${this.item.stack > 1 ? ` × ${this.item.stack}` : ""}`,
				`Slot ${this.item.globalSlot}${this.label ? ` (${this.label})` : ""}`,
			];
			if (this.item.favorited) {
				lines.push("Favorited");
			}
			return lines.join("\n");
		},
	},
};
</script>

<style scoped>
/* Terraria sprites are pixel art; the browser's default smoothing turns them to mush when scaled. */
.sprite {
	image-rendering: pixelated;
}
</style>
