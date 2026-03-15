<template>
	<div class="w-full">
		<div class="flex flex-wrap gap-2">
			<div class="flex flex-col">
				<div class="font-main font-bold text-gray-9">Date (YYYY / MM / DD)</div>
				<div class="flex gap-2">
					<Dropdown
						:modelValue="selectedYear"
						:options="yearOptions"
						:disabled="disabled"
						:inputClass="[inputClass, 'w-max']"
						:optionClass="optionClass"
						:iconColor="iconColor"
						@update:modelValue="onYearChange"
					/>
					<Dropdown
						:modelValue="selectedMonth"
						:options="monthOptions"
						:disabled="disabled"
						:inputClass="inputClass"
						:optionClass="optionClass"
						:iconColor="iconColor"
						@update:modelValue="onMonthChange"
					/>
					<Dropdown
						:modelValue="selectedDay"
						:options="dayOptions"
						:disabled="disabled"
						:inputClass="inputClass"
						:optionClass="optionClass"
						:iconColor="iconColor"
						@update:modelValue="onDayChange"
					/>
				</div>
			</div>
			<div class="flex flex-col">
				<div class="font-main font-bold text-gray-9">Time (24H)</div>
				<div class="flex gap-2">
					<Dropdown
						:modelValue="selectedHour"
						:options="hourOptions"
						:disabled="disabled"
						:inputClass="inputClass"
						:optionClass="optionClass"
						:iconColor="iconColor"
						@update:modelValue="onHourChange"
					/>
					<Dropdown
						:modelValue="selectedMinute"
						:options="minuteOptions"
						:disabled="disabled"
						:inputClass="inputClass"
						:optionClass="optionClass"
						:iconColor="iconColor"
						@update:modelValue="onMinuteChange"
					/>
					<Dropdown
						:modelValue="selectedSecond"
						:options="secondOptions"
						:disabled="disabled"
						:inputClass="inputClass"
						:optionClass="optionClass"
						:iconColor="iconColor"
						@update:modelValue="onSecondChange"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<script>
import Dropdown from './Dropdown.vue';

const DATE_TIME_REGEX = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export default {
	components: {
		Dropdown,
	},
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
		inputClass: {
			type: String,
			default: 'bg-teal-3 text-white-1',
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
			selectedYear: '',
			selectedMonth: '',
			selectedDay: '',
			selectedHour: '',
			selectedMinute: '',
			selectedSecond: '',
		};
	},
	computed: {
		resolvedStartYear() {
			const currentYear = new Date().getFullYear();
			return this.startYear ?? currentYear - 5;
		},
		resolvedEndYear() {
			const currentYear = new Date().getFullYear();
			return this.endYear ?? currentYear + 5;
		},
		yearOptions() {
			const options = [];
			const start = Math.min(this.resolvedStartYear, this.resolvedEndYear);
			const end = Math.max(this.resolvedStartYear, this.resolvedEndYear);

			for (let year = start; year <= end; year++) {
				const value = String(year);
				options.push({ id: value, text: value });
			}

			return options;
		},
		monthOptions() {
			return this.buildPaddedOptions(1, 12);
		},
		dayOptions() {
			const year = Number(this.selectedYear);
			const month = Number(this.selectedMonth);
			const days = this.getDaysInMonth(year, month);
			return this.buildPaddedOptions(1, days);
		},
		hourOptions() {
			return this.buildPaddedOptions(0, 23);
		},
		minuteOptions() {
			return this.buildPaddedOptions(0, 59);
		},
		secondOptions() {
			return this.buildPaddedOptions(0, 59);
		},
	},
	watch: {
		modelValue(newValue) {
			if (newValue === this.formatDateTime()) return;

			const isValid = this.syncFromValue(newValue);
			if (!isValid) {
				this.emitCurrentValue();
			}
		},
	},
	created() {
		const isValid = this.syncFromValue(this.modelValue);
		if (!isValid) {
			this.emitCurrentValue();
		}
	},
	methods: {
		buildPaddedOptions(start, end) {
			const options = [];
			for (let i = start; i <= end; i++) {
				const value = String(i).padStart(2, '0');
				options.push({ id: value, text: value });
			}
			return options;
		},
		getDaysInMonth(year, month) {
			if (!year || !month) return 31;
			return new Date(year, month, 0).getDate();
		},
		clamp(value, min, max) {
			return Math.max(min, Math.min(max, value));
		},
		formatDateTime() {
			return `${this.selectedYear}-${this.selectedMonth}-${this.selectedDay} ${this.selectedHour}:${this.selectedMinute}:${this.selectedSecond}`;
		},
		emitCurrentValue() {
			this.$emit('update:modelValue', this.formatDateTime());
		},
		normalizeDay() {
			const year = Number(this.selectedYear);
			const month = Number(this.selectedMonth);
			const maxDay = this.getDaysInMonth(year, month);
			const day = this.clamp(Number(this.selectedDay), 1, maxDay);
			this.selectedDay = String(day).padStart(2, '0');
		},
		syncFromValue(value) {
			const match = typeof value === 'string' ? value.match(DATE_TIME_REGEX) : null;
			if (!match) {
				const now = new Date();
				this.selectedYear = String(now.getFullYear());
				this.selectedMonth = String(now.getMonth() + 1).padStart(2, '0');
				this.selectedDay = String(now.getDate()).padStart(2, '0');
				this.selectedHour = String(now.getHours()).padStart(2, '0');
				this.selectedMinute = String(now.getMinutes()).padStart(2, '0');
				this.selectedSecond = String(now.getSeconds()).padStart(2, '0');
				return false;
			}

			const parsedYear = this.clamp(Number(match[1]), Math.min(this.resolvedStartYear, this.resolvedEndYear), Math.max(this.resolvedStartYear, this.resolvedEndYear));
			const parsedMonth = this.clamp(Number(match[2]), 1, 12);
			const parsedHour = this.clamp(Number(match[4]), 0, 23);
			const parsedMinute = this.clamp(Number(match[5]), 0, 59);
			const parsedSecond = this.clamp(Number(match[6]), 0, 59);
			const parsedDay = this.clamp(Number(match[3]), 1, this.getDaysInMonth(parsedYear, parsedMonth));

			this.selectedYear = String(parsedYear);
			this.selectedMonth = String(parsedMonth).padStart(2, '0');
			this.selectedDay = String(parsedDay).padStart(2, '0');
			this.selectedHour = String(parsedHour).padStart(2, '0');
			this.selectedMinute = String(parsedMinute).padStart(2, '0');
			this.selectedSecond = String(parsedSecond).padStart(2, '0');
			return true;
		},
		onYearChange(value) {
			this.selectedYear = value;
			this.normalizeDay();
			this.emitCurrentValue();
		},
		onMonthChange(value) {
			this.selectedMonth = value;
			this.normalizeDay();
			this.emitCurrentValue();
		},
		onDayChange(value) {
			this.selectedDay = value;
			this.normalizeDay();
			this.emitCurrentValue();
		},
		onHourChange(value) {
			this.selectedHour = value;
			this.emitCurrentValue();
		},
		onMinuteChange(value) {
			this.selectedMinute = value;
			this.emitCurrentValue();
		},
		onSecondChange(value) {
			this.selectedSecond = value;
			this.emitCurrentValue();
		},
	},
};
</script>

<style scoped>

</style>
