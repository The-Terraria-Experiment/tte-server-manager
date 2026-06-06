<template>
	<input 
		:type="type"
		:placeholder="placeholder"
		:disabled="disabled"
		@beforeinput="validateInput"
		@input.stop="emitInput"
		:value="modelValue"
	/>
</template>

<script>
export default {
	components: {

	},
	props: {
		type: {
			type: String,
			default: "text",
			validator: (val) => ['text', 'number', 'password'].includes(val)
		},
		placeholder: {
			type: String,
			default: ""
		},
		disabled: {
			type: Boolean,
			default: false
		},
		modelValue: {
			type: [String, Number],
			default: null
		},
		inputAllowed: {
			type: [Set, null],
			default: null
		}
	},
	data() {
		return {

		}
	},
	computed: {

	},
	methods: {
		validateInput(event) {
			// Only validate if inputAllowed is set
			if (!this.inputAllowed) return;

			// Check if this is a character insertion (not deletion, etc)
			if (event.inputType === 'insertText' && event.data) {
				// Check each character in the input data
				for (const char of event.data) {
					if (!this.inputAllowed.has(char)) {
						event.preventDefault();
						return;
					}
				}
			}
		},
		emitInput(event) {
			if (this.disabled) return;

			this.$emit('update:modelValue', event.target.value);
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";

input {
	appearance: none;
	@apply text-gray-1
}

input::placeholder {
	appearance: none;
}
</style>