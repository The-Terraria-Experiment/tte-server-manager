<template>
	<div :title="hoverText">
		<svg v-if="color" :class="iconClasses" :style="rawStyle">
			<use :xlink:href="iconPath"></use>
		</svg>
		<img v-else :src="iconPath" :class="iconClasses" />
	</div>
</template>

<script>
export default {
	components: {},
	props: {
		icon: {
			type: String,
			default: "",
		},
		size: {
			type: String,
			default: "8",
		},
		color: {
			type: [String, null],
			default: null,
		},
		hoverText: {
			type: String,
			default: "",
		},
	},
	data() {
		return {
			
		};
	},
	computed: {
		iconPath() {
			return `icons/${this.icon}.svg#icon`;
		},
		iconClasses() {
			const col = this.color ?? '';
			return `h-${this.size} w-${this.size} ${col}`;
		},
		rawStyle() {
			if (!this.color) {
				return { color: "currentColor" };
			}
			return {};
		}
	},
};
</script>

<style scoped>
</style>
