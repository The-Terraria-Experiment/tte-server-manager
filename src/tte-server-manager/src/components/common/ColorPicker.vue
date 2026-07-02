<template>
	<div class="flex flex-wrap items-center gap-2">
		<button
			v-if="allowNone"
			type="button"
			:disabled="disabled"
			:class="[
				'h-8 w-8 rounded-full border-2 flex items-center justify-center bg-gray-4',
				!modelValue ? 'border-white-0' : 'border-transparent',
				disabled ? 'cursor-default opacity-60' : 'cursor-pointer hover:opacity-80'
			]"
			title="No color"
			@click="select('')"
		>
			<Icon icon="xmark" size="3" color="text-gray-8" />
		</button>
		<button
			v-for="swatch in swatches"
			:key="swatch"
			type="button"
			:disabled="disabled"
			:style="{ backgroundColor: swatch }"
			:class="[
				'h-8 w-8 rounded-full border-2',
				modelValue === swatch ? 'border-white-0' : 'border-transparent',
				disabled ? 'cursor-default opacity-60' : 'cursor-pointer hover:opacity-80'
			]"
			:title="swatch"
			@click="select(swatch)"
		></button>
		<label
			:class="[
				'relative h-8 w-8 rounded-full border-2 flex items-center justify-center overflow-hidden',
				isCustomActive ? 'border-white-0' : 'border-transparent bg-gray-4',
				disabled ? 'cursor-default opacity-60' : 'cursor-pointer hover:opacity-80'
			]"
			:style="customSwatchStyle"
			title="Custom color"
		>
			<Icon v-if="!isCustomActive" icon="plus" size="3" color="text-gray-8" />
			<input
				type="color"
				class="absolute inset-0 h-full w-full opacity-0"
				:class="disabled ? 'pointer-events-none' : 'cursor-pointer'"
				:value="customInputValue"
				:disabled="disabled"
				@input="onCustomInput"
			/>
		</label>
	</div>
</template>

<script>
import Icon from './Icon.vue';

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

// Curated accent colors pulled from the app theme (src/theme.css) so role colors stay on-brand by default.
export const DEFAULT_SWATCHES = [
	'#6dbcb0', // teal-4
	'#00b7ff', // blue-2
	'#9061bd', // purple-4
	'#5d7f66', // green-4
	'#fea520', // yellow-1
	'#cc4c62', // red-3
	'#e4f9de', // cream
];

export default {
	components: {
		Icon,
	},
	props: {
		modelValue: {
			type: String,
			default: ''
		},
		swatches: {
			type: Array,
			default: () => DEFAULT_SWATCHES
		},
		disabled: {
			type: Boolean,
			default: false
		},
		allowNone: {
			type: Boolean,
			default: true
		}
	},
	emits: ['update:modelValue'],
	computed: {
		isCustomActive() {
			return !!this.modelValue && !this.swatches.includes(this.modelValue);
		},
		customSwatchStyle() {
			if (this.isCustomActive && HEX_PATTERN.test(this.modelValue)) {
				return { backgroundColor: this.modelValue };
			}
			return {};
		},
		customInputValue() {
			return HEX_PATTERN.test(this.modelValue) ? this.modelValue : '#ffffff';
		}
	},
	methods: {
		select(color) {
			if (this.disabled) return;

			this.$emit('update:modelValue', color);
		},
		onCustomInput(event) {
			if (this.disabled) return;

			this.$emit('update:modelValue', event.target.value);
		}
	}
}
</script>

<style scoped>

</style>
