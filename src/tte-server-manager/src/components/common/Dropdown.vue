<template>
	<div class="relative inline-block w-full font-main font-bold">
		<select 
			:class="['appearance-none pr-9 w-full rounded-lg px-4 py-2 outline-none cursor-pointer font-main font-bold', inputClass]"
			@change="emitInput"
			:disabled="disabled"
			:value="modelValue"
		>
			<template v-for="option of options">
				<option 
					:class="['font-main font-semibold', optionClass]"
					:value="option.id"
				>
					{{ option.text }}
				</option>
			</template>
		</select>
		<Icon 
			icon="caret-down" 
			size="6" 
			:color="iconColor" 
			class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 text-white"
		/>
	</div>
</template>

<script>
import Icon from './Icon.vue';


export default {
	mixins: [],
	components: {
		Icon,
	},
	props: {
		modelValue: {
			default: null
		},
		options: {
			type: Array,
			default: []
		},
		optionClass: {
			type: String,
			default: ""
		},
		disabled: {
			type: Boolean,
			default: false
		},
		inputClass: {
			type: String,
			default: ''
		},
		iconColor: {
			type: String,
			default: "text-teal-4"
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

			this.$emit('update:modelValue', event.currentTarget.value);
		}
	},
}
</script>

<style scoped>

</style>
