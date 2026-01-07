<template>
	<div 
		:class="['rounded bg-gray-1 p-0.5', { 'cursor-pointer': !disabled }]"
		@click="input"
	>
		<Icon 
			v-show="value || modelValue"
			icon="checkmark" 
			color="text-teal-4" 
			class="h-full w-full relative"
			svgStyle="h-full w-full"
			:size="null"
		/>
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
		value: {
			type: Boolean,
			default: false
		},
		modelValue: {
			type: Boolean,
			default: false
		}
	},
	data() {
		return {
			
		}
	},
	methods: {
		input() {
			if (this.disabled) return;
			this.$emit('input', !this.value);
			this.$emit("update:modelValue", !this.modelValue);
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";
</style>