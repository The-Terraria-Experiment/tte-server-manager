<template>
	<template v-if="type === ACTIVE_DATE_VARIANT.ELAPSED_COMPACT">
		<div :class="className">
			{{ elapsedTime.days }} :
			{{ elapsedTime.hours }} :
			{{ elapsedTime.minutes }} :
			{{ elapsedTime.seconds }} 
		</div>
	</template>
</template>

<script>
import { ACTIVE_DATE_VARIANT } from '../../util/constants';
import { getElapsedTime } from '../../util/elapsedTime';


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
			elapsedTime: { days: 0, hours: 0, minutes: 0, seconds: 0 },
			updateIntervalRef: null,
		}
	},
	computed: {
		
	},
	methods: {
		updateElapsedTime() {
			const values = getElapsedTime(this.date);
			this.elapsedTime = {
				days: values.days.toString(),
				hours: values.hours.toString().padStart(2, "0"),
				minutes: values.minutes.toString().padStart(2, "0"),
				seconds: values.seconds.toString().padStart(2, "0")
			};
		}
	},
	mounted() {
		if (this.type === ACTIVE_DATE_VARIANT.ELAPSED_COMPACT) {
			this.updateElapsedTime();
			this.updateIntervalRef = setInterval(() => this.updateElapsedTime(), this.updateInterval);
		}
	},
	beforeUnmount() {
		clearInterval(this.updateIntervalRef);
	}
}
</script>

<style scoped>

</style>
