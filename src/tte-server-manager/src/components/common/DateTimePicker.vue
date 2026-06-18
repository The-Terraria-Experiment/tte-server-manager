<template>
	<div class="relative w-full">
		<input
			ref="input"
			type="datetime-local"
			:value="nativeValue"
			:disabled="disabled"
			:min="minValue"
			:max="maxValue"
			step="1"
			class="datetime-picker w-full font-main font-bold bg-teal-3 text-white-1 rounded-lg px-4 py-2 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
			@change="onChange"
		/>
		<div
			v-if="!disabled"
			class="absolute inset-0 cursor-pointer rounded-lg"
			@click="$refs.input.showPicker()"
		/>
	</div>
</template>

<script>
const DATE_TIME_REGEX = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export default {
	props: {
		modelValue: {
			type: String,
			default: null,
		},
		disabled: {
			type: Boolean,
			default: false,
		},
		startYear: {
			type: Number,
			default: null,
		},
		endYear: {
			type: Number,
			default: null,
		},
	},
	computed: {
		resolvedStartYear() {
			return this.startYear ?? new Date().getFullYear() - 5;
		},
		resolvedEndYear() {
			return this.endYear ?? new Date().getFullYear() + 5;
		},
		nativeValue() {
			const match = typeof this.modelValue === 'string' ? this.modelValue.match(DATE_TIME_REGEX) : null;
			if (!match) return '';
			return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
		},
		minValue() {
			return `${Math.min(this.resolvedStartYear, this.resolvedEndYear)}-01-01T00:00:00`;
		},
		maxValue() {
			return `${Math.max(this.resolvedStartYear, this.resolvedEndYear)}-12-31T23:59:59`;
		},
	},
	created() {
		if (!this.modelValue || !this.modelValue.match(DATE_TIME_REGEX)) {
			this.$emit('update:modelValue', this.defaultValue());
		}
	},
	methods: {
		pad(n) {
			return String(n).padStart(2, '0');
		},
		defaultNativeValue() {
			const now = new Date();
			return `${now.getFullYear()}-${this.pad(now.getMonth() + 1)}-${this.pad(now.getDate())}T${this.pad(now.getHours())}:${this.pad(now.getMinutes())}:${this.pad(now.getSeconds())}`;
		},
		defaultValue() {
			return this.defaultNativeValue().replace('T', ' ');
		},
		onChange(event) {
			const val = event.target.value;
			if (!val) {
				this.$emit('update:modelValue', null);
				return;
			}
			// Native value is YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS depending on browser
			const withSeconds = val.length === 16 ? `${val}:00` : val;
			this.$emit('update:modelValue', withSeconds.replace('T', ' '));
		},
	},
};
</script>

<style scoped>
.datetime-picker::-webkit-calendar-picker-indicator {
	filter: brightness(0) invert(1);
	opacity: 0.7;
	cursor: pointer;
}

.datetime-picker::-webkit-calendar-picker-indicator:hover {
	opacity: 1;
}
</style>
