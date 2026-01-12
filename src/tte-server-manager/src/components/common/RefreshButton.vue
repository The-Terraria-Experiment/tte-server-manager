<template>
	<FlexButton 
		class="bg-gray-4 hover:bg-gray-2 w-max pl-4 pr-6 py-2 mt-4" 
		@input="$emit('input')"
		:disabled="loading"
	>
		<div class="flex items-center">
			<Spinner v-if="loading" class="h-4 w-4 text-teal-3" thickness="4" />
			<Icon v-else icon="arrow-rotate-right" color="text-teal-3" size="4" />
			<p class="text-teal-3 ml-2 font-main font-bold flex">
				REFRESH 
				<span v-if="refreshAt" class="pl-2">(AUTO REFRESH IN 
					<ActiveDate 
						:type="ACTIVE_DATE_VARIANT.COUNTDOWN" 
						:date="new Date(refreshAt)" 
						@countdownExpired="refreshCountdownExpired" 
						:update-interval="200"
					/>
				)
				</span>
			</p>
		</div>
	</FlexButton>
</template>

<script>
import { ACTIVE_DATE_VARIANT } from '../../util/constants';
import ActiveDate from './ActiveDate.vue';
import FlexButton from './FlexButton.vue';
import Icon from './Icon.vue';
import Spinner from './Spinner.vue';


export default {
	mixins: [],
	components: {
		FlexButton,
		Icon,
		Spinner,
		ActiveDate,
	},
	props: {
		loading: {
			type: Boolean,
			default: false
		},
		refreshAt: {
			type: [Number, null],
			default: null
		}
	},
	data() {
		return {
			ACTIVE_DATE_VARIANT,
		}
	},
	computed: {
		
	},
	methods: {
		refreshCountdownExpired() {
			this.$emit('input');
		}
	},
}
</script>

<style scoped>

</style>
