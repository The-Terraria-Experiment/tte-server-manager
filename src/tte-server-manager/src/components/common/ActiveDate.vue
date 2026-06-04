<template>
	<template v-if="type === ACTIVE_DATE_VARIANT.ELAPSED_COMPACT">
		<div :class="className">
			{{ timeValues.days }}d :
			{{ timeValues.hours }}h :
			{{ timeValues.minutes }}m :
			{{ timeValues.seconds }}s 
		</div>
	</template>
	<template v-else-if="type === ACTIVE_DATE_VARIANT.COUNTDOWN">
		<span>
			<span v-if="timeValues.days > 0">{{ timeValues.days }}d </span>
			<span v-if="timeValues.hours > 0">{{ timeValues.hours }}h </span>
			<span v-if="timeValues.minutes > 0">{{ timeValues.minutes }}m </span>
			<span v-if="timeValues.seconds >= 0">{{ timeValues.seconds }}s</span>
		</span>
	</template>
</template>

<script>
import { ACTIVE_DATE_VARIANT } from '../../util/constants';
import { getElapsedTime, getTimeUntil } from '../../util/timeutils';


export default {
	mixins: [],
	components: {
		
	},
	props: {
		date: {
			type: Object,
			required: true
		},
		type: {
			type: String,
			default: ACTIVE_DATE_VARIANT.ELAPSED_COMPACT
		},
		className: {
			type: [String, Array],
			default: ""
		},
		updateInterval: {
			type: Number,
			default: 1000
		}
	},
	data() {
		return {
			ACTIVE_DATE_VARIANT,
			timeValues: { days: 0, hours: 0, minutes: 0, seconds: 0 },
			updateIntervalRef: null,
			emittedExpiry: false,
		}
	},
	computed: {
		
	},
	methods: {
		init() {
			switch (this.type) {
				case ACTIVE_DATE_VARIANT.ELAPSED_COMPACT:
					this.updateElapsedTime();
					this.updateIntervalRef = setInterval(() => this.updateElapsedTime(), this.updateInterval);
					break;
				case ACTIVE_DATE_VARIANT.COUNTDOWN:
					this.emittedExpiry = false;
					clearInterval(this.updateIntervalRef);
					this.updateIntervalRef = setInterval(() => this.updateCountdown(), this.updateInterval);
					this.updateCountdown();
					break;
			}
		},
		updateElapsedTime() {
			const values = getElapsedTime(this.date);
			this.timeValues = {
				days: values.days.toString(),
				hours: values.hours.toString().padStart(2, "0"),
				minutes: values.minutes.toString().padStart(2, "0"),
				seconds: values.seconds.toString().padStart(2, "0")
			};
		},
		updateCountdown() {
			this.timeValues = getTimeUntil(this.date);
			if (
				this.timeValues.days <= 0 &&
				this.timeValues.hours <= 0 &&
				this.timeValues.minutes <= 0 &&
				this.timeValues.seconds <= 0 &&
				!this.emittedExpiry
			) {
				this.timeValues = { days: 0, hours: 0, minutes: 0, seconds: 0 };
				this.emittedExpiry = true;
				this.$emit("countdownExpired");
				clearInterval(this.updateIntervalRef);
			}
		}
	},
	mounted() {
		this.init();
	},
	beforeUnmount() {
		clearInterval(this.updateIntervalRef);
	},
	watch: {
		date(newValue, oldValue) {
			if (oldValue.valueOf() === newValue.valueOf()) return;

			switch (this.type) {
				case ACTIVE_DATE_VARIANT.ELAPSED_COMPACT:
					this.updateElapsedTime();
					break;
				case ACTIVE_DATE_VARIANT.COUNTDOWN:
					this.init();
					break;
			}
		}
	}
}
</script>

<style scoped>

</style>
