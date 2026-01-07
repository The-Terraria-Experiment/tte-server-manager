<template>
	<input 
		:type="type"
		:placeholder="placeholder"
		:disabled="disabled"
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
		}
	},
	data() {
		return {

		}
	},
	computed: {

	},
	methods: {
		emitInput(event) {
			if (this.disabled) return;

			this.$emit('update:modelValue', event.target.value);
		}
	}
}
</script>

<style scoped>

</style>