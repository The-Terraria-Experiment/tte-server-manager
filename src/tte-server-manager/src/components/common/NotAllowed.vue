<template>
	<StatusTile class="not-allowed-tile">
		<template #header>
			<Icon icon="warning" color="text-white-0" size="4" />
			<p class="text-white-0 ml-2 text-lg">Insufficient Permissions</p>
		</template>
		<template #summary>
			<p class="text-2xl text-red-5">TOOL(S) UNAVAILABLE</p>
		</template>
	</StatusTile>
</template>

<script>
import Icon from './Icon.vue';
import StatusTile from './StatusTile.vue';

export default {
	mixins: [],
	components: {
		StatusTile,
		Icon,
	},
	props: {
		
	},
	data() {
		return {
			
		}
	},
	computed: {
		
	},
	methods: {
		
	},
}
</script>

<style scoped>
@reference "../../theme.css";

.not-allowed-tile {
	@apply bg-linear-to-b from-gray-3 to-red-0 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
}
</style>
