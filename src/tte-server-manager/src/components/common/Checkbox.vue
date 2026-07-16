<template>
	<input
		ref="checkbox"
		type="checkbox"
		class="accent-blue-3"
		:class="{ 'cursor-pointer': !disabled, 'cursor-not-allowed': disabled }"
		:checked="isChecked"
		:disabled="disabled"
		@change="input"
	/>
</template>

<script>
export default {
	emits: ['input', 'update:modelValue'],
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
	watch: {
		isIndeterminate: {
			immediate: true,
			handler(value) {
				// The indeterminate state has no HTML attribute; it must be set as a DOM property.
				this.$nextTick(() => {
					if (this.$refs.checkbox) this.$refs.checkbox.indeterminate = value;
				});
			}
		}
	},
	methods: {
		input(e) {
			if (this.disabled) return;
			const next = e.target.checked;
			this.$emit('input', next);
			this.$emit('update:modelValue', next);
		}
	}
}
</script>
