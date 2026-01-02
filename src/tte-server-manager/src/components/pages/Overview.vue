<template>
	<div class="w-full">
		<div class="flex flex-col sm:flex-row w-full">
			<StatusTile class="grow sm:mr-4 mb-4 sm:mb-8 gradient-tile-red" collapsible>
				<template #header>
					<Icon icon="power" color="text-gray-6" size="4" />
					<p class="text-gray-6 ml-2 text-lg">Instance Status</p>
				</template>
				<template #summary>
					<p class="text-2xl text-teal-4">ONLINE</p>
				</template>
				<template #content>
					<div>
						<FlexButton class="mx-4 mb-4" :variant="BTN_VARIANT.DANGER">
							<p class="py-2 px-12">STOP</p>
						</FlexButton>
					</div>
				</template>
			</StatusTile>

			<StatusTile class="grow sm:ml-4 mb-8 gradient-tile">
				<template #header>
					<Icon icon="power" color="text-gray-6" size="4" />
					<p class="text-gray-6 ml-2 text-lg">Server Status</p>
				</template>
				<template #summary>
					<p class="text-2xl text-teal-4">RUNNING</p>
				</template>
			</StatusTile>
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