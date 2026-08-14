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
			// `change` fires only after the browser has already flipped `checked` natively --
			// undo that immediately and unconditionally, synchronously, before deciding anything
			// else. This can't be left for a later re-render to fix: Vue only repatches `checked`
			// when the bound prop itself changes, and if the emit below goes unheeded -- a caller
			// forgot `:disabled`, or a guard elsewhere blocked the mutation -- nothing reactive
			// changes here at all, so no re-render would ever come along to correct it. Forcing the
			// DOM back to the true value ourselves, right here, is what makes a native toggle nobody
			// agreed to impossible to see, even for a single frame.
			e.target.checked = this.isChecked;
			if (this.disabled) return;
			const next = !this.isChecked;
			this.$emit('input', next);
			this.$emit('update:modelValue', next);
		}
	}
}
</script>
