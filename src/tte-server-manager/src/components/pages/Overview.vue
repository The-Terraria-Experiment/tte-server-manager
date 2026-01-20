<template>
	<div class="w-full flex flex-col gap-4 sm:gap-8">
		<div class="bg-gray-3 rounded-xl overflow-hidden h-max p-4">
			<h1 class="font-main font-bold text-2xl text-teal-4 mb-8">The Terraria Experiment Server Manager</h1>
			<p class="font-main font-semibold text-white-0 mt-4">Welcome! Parts of this site are still under construction. There may be bugs, bad UI/UX, or broken tools.</p>
			<p class="font-main font-semibold text-white-0 mt-4">
				Please report any issues you find by messaging in <span class="text-yellow-2">#mod-help</span> in the Discord server. Make sure to ping <span class="text-yellow-2">@havoc</span>.
			</p>
			<p class="font-main font-semibold text-white-0 mt-4">Thank you!</p>
		</div>

		<div class="bg-gray-3 rounded-xl overflow-hidden h-max p-4">
			<h1 class="font-main font-bold text-2xl text-teal-4 mb-8">Usage Guide</h1>

			<h3 class="font-main font-bold text-xl text-gray-7">Instance Page</h3>
			<p class="font-main font-semibold text-white-0 mt-4">The "instance" is the physical computer that we are using to host the server.</p>
			<p class="font-main font-semibold text-white-0 mt-4">Use the Instance page to turn on/off the computer. Click the "Instance Status" section to reveal the buttons.</p>
			<p class="font-main font-semibold text-white-0 mt-4"><span class="text-red-5">NOTE:</span> Stopping the instance without first stopping the Terraria server will NOT save the world! Any unsaved progress will be LOST!</p>

			<h3 class="font-main font-bold text-xl text-gray-7 mt-8">Server Page</h3>
			<p class="font-main font-semibold text-white-0 mt-4">The "server" is the actual Terraria game server.</p>
			<p class="font-main font-semibold text-white-0 mt-4">Start the server by selecting a world from the "Launch World" section and then clicking "Start Server".</p>

			<h3 class="font-main font-bold text-xl text-gray-7 mt-8">General</h3>
			<p class="font-main font-semibold text-white-0 mt-4">Please be kind to the system. If something is not working, refresh the web page and give it a second. Spamming won't fix things.</p>
			<p class="font-main font-semibold text-white-0 mt-4">If problems persist, feel free to ping @havoc, and I'll get to it as soon as I can.</p>
		</div>
	</div>
</template>

<script>
import screen from '../../mixins/screen';
import { BTN_VARIANT } from '../../util/constants';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import Spinner from '../common/Spinner.vue';
import StatusTile from '../common/StatusTile.vue';


export default {
	mixins: [screen],
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