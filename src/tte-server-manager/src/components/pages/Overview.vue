<template>
	<div class="w-full">
		<div class="flex w-full">
			<StatusTile class="grow mr-4 mb-8 gradient-tile" collapsible>
				<template #header>
					<div class="flex items-center px-4 pt-2 pb-4">
						<Icon icon="power" color="text-gray-6" size="4" />
						<p class="text-gray-6 ml-2 text-lg">Instance Status</p>
					</div>
				</template>
				<template #summary>
					<div class="px-4 pb-4">
						<p class="text-2xl text-teal-4">ONLINE</p>
					</div>
				</template>
				<template #content>
					<div>
						<FlexButton class="mx-4 mb-4" :variant="BTN_VARIANT.DANGER">
							<p class="py-2 px-12">STOP</p>
						</FlexButton>
					</div>
				</template>
			</StatusTile>

			<StatusTile class="grow ml-4 mb-8 gradient-tile" collapsible>
				<template #header>
					<div class="flex items-center px-4 pt-2 pb-4">
						<Icon icon="power" color="text-gray-6" size="4" />
						<p class="text-gray-6 ml-2 text-lg">Server Status</p>
					</div>
				</template>
				<template #summary>
					<div class="px-4 pb-4">
						<p class="text-2xl text-teal-4">RUNNING</p>
					</div>
				</template>
				<template #content>
					<div class="bg-red-0 h-40"></div>
				</template>
			</StatusTile>
		</div>
	</div>
</template>

<script>
import { BTN_VARIANT } from '../../util/constants';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import StatusTile from '../common/StatusTile.vue';


export default {
	components: {
		StatusTile,
		Icon,
		FlexButton,
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

.gradient-tile {
	@apply bg-linear-to-b from-gray-3 to-green-2 from-50%;
	background-size: 100% 200%;
	background-position: 0% 0%;
	transition: background-position 200ms ease;
}

.gradient-tile:hover {
	background-position: 0% 100%;
}
</style>