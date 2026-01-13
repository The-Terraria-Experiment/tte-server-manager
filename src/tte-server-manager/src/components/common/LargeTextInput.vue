<template>
	<textarea 
		spellcheck="false"
		class="bg-gray-1 text-white-1 p-2"
		:placeholder="placeholder"
		:disabled="disabled"
		@beforeinput="validateInput"
		@input.stop="emitInput"
		:value="modelValue"
	></textarea>
</template>

<script>
export default {
	components: {

	},
	props: {
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

</style>