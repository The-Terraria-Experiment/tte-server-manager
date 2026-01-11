<template>
	<div class="w-full">
		<div class="bg-gray-3 rounded-xl overflow-hidden h-max p-4">
			<h1 class="font-main font-bold text-2xl text-teal-4 mb-8">The Terraria Experiment Server Manager</h1>
			<p class="font-main font-semibold text-white-0 mt-4">Welcome! Parts of this site are still under construction. There may be bugs, bad UI/UX, or broken tools.</p>
			<p class="font-main font-semibold text-white-0 mt-4">
				Please report any issues you find by messaging in <span class="text-yellow-2">#mod-help</span> in the Discord server. Make sure to ping <span class="text-yellow-2">@havoc</span>.
			</p>
			<p class="font-main font-semibold text-white-0 mt-4">Thank you!</p>
		</div>
	</div>
</template>

<script>
import { BTN_VARIANT } from '../../util/constants';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import Spinner from '../common/Spinner.vue';
import StatusTile from '../common/StatusTile.vue';


export default {
	components: {
		StatusTile,
		Icon,
		FlexButton,
		Spinner,
	},
	props: {

	},
	data() {
		return {
			BTN_VARIANT,
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";

.gradient-tile-green {
	@apply bg-linear-to-b from-gray-3 to-green-2 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
	/* transition: background-position 200ms ease; */
}

.gradient-tile-red {
	@apply bg-linear-to-b from-gray-3 to-red-900 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
}

/* .gradient-tile:hover {
	background-position: 0% 100%;
} */
</style>