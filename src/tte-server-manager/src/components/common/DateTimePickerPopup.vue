<template>
	<Popup
		:open="open"
		:header-text="headerText"
		:body-class="bodyClass"
		:layer="layer"
		:buttons="popupButtons"
		@x-clicked="onCancel"
	>
		<div class="p-4">
			<DateTimePicker
				v-model="pendingValue"
				:start-year="startYear"
				:end-year="endYear"
				:input-class="inputClass"
				:option-class="optionClass"
				:icon-color="iconColor"
			/>
			<p class="italic text-gray-6 font-main font-bold mt-4 text-center">Dates and times are displayed in your timezone.</p>
		</div>
	</Popup>
</template>

<script>
import { BTN_VARIANT } from '../../util/constants';
import DateTimePicker from './DateTimePicker.vue';
import Popup from './Popup.vue';

export default {
	components: {
		Popup,
		DateTimePicker,
	},
	emits: ['update:modelValue', 'close', 'cancel'],
	props: {
		modelValue: {
			type: String,
			default: null,
		},
		open: {
			type: Boolean,
			default: false,
		},
		headerText: {
			type: String,
			default: 'SELECT DATE & TIME',
		},
		bodyClass: {
			type: String,
			default: 'w-11/12 sm:w-3/4 lg:w-1/5 h-min',
		},
		layer: {
			type: String,
			default: '2',
		},
		startYear: {
			type: Number,
			default: null,
		},
		endYear: {
			type: Number,
			default: null,
		},
		inputClass: {
			type: String,
			default: 'bg-teal-2 text-white-1',
		},
		optionClass: {
			type: String,
			default: '',
		},
		iconColor: {
			type: String,
			default: 'text-white-1',
		},
	},
	data() {
		return {
			pendingValue: this.modelValue,
		};
	},
	watch: {
		open(isOpen) {
			if (isOpen) {
				this.pendingValue = this.modelValue;
			}
		},
	},
	computed: {
		popupButtons() {
			return [
				{ variant: BTN_VARIANT.DANGER, text: 'CANCEL', onClick: this.onCancel },
				{ variant: BTN_VARIANT.PRIMARY, text: 'CONFIRM', onClick: this.onConfirm },
			];
		},
	},
	methods: {
		onConfirm() {
			this.$emit('update:modelValue', this.pendingValue);
			this.$emit('close');
		},
		onCancel() {
			this.$emit('cancel');
		},
	},
};
</script>

<style scoped>

</style>
