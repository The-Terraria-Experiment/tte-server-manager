<template>
	<div
		:class="['rounded bg-gray-1 p-0.5', { 'cursor-pointer': !disabled }]"
		@click="input"
	>
		<Icon
			v-if="isChecked"
			icon="checkmark"
			color="text-teal-4"
			class="h-full w-full relative"
			svgStyle="h-full w-full"
			:size="null"
		/>
		<div v-else-if="isIndeterminate" class="h-full w-full flex items-center justify-center">
			<div class="w-2/3 h-0.5 rounded bg-teal-4"></div>
		</div>
	</div>
</template>

<script>
import Icon from './Icon.vue';

export default {
	components: {
		Icon,
	},
	props: {
		disabled: {
			type: Boolean,
			default: false
		},
		// null represents an indeterminate state
		value: {
			type: null,
			default: false
		},
		modelValue: {
			type: null,
			default: false
		}
	},
	data() {
		return {

		}
	},
	computed: {
		effectiveValue() {
			// value/modelValue are dual APIs (manual @input vs v-model); whichever
			// was actually set to something other than the default "false" wins.
			return this.value !== false ? this.value : this.modelValue;
		},
		isChecked() {
			return this.effectiveValue === true;
		},
		isIndeterminate() {
			return this.effectiveValue === null;
		}
	},
	methods: {
		input() {
			if (this.disabled) return;
			const next = !this.effectiveValue;
			this.$emit('input', next);
			this.$emit("update:modelValue", next);
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";
</style>