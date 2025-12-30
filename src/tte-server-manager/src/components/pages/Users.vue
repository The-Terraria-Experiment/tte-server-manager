<template>
	<div>
		<StatusTile>
			<template #header>
				<Icon icon="key" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">User Permissions</p>
			</template>
			<template #summary>
				<FlexButton class="bg-gray-4 hover:bg-gray-2 w-max pl-4 pr-6 py-2" @input="fetchUserPermissions">
					<div class="flex items-center">
						<Spinner v-if="loading.permissions" class="h-4 w-4 text-teal-3" thickness="4" />
						<Icon v-else icon="arrow-rotate-right" color="text-teal-3" size="4" />
						<p class="text-teal-3 ml-2">REFRESH</p>
					</div>
				</FlexButton>
			</template>
		</StatusTile>
	</div>
</template>

<script>
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
			loading: {
				permissions: false
			}
		}
	},
	computed: {

	},
	methods: {
		fetchUserPermissions() {
			if (this.loading.permissions) return;
			this.loading.permissions = true;



			this.loading.permissions = false;
		}
	},
	mounted() {
		this.fetchUserPermissions();
	}
}
</script>

<style scoped>

</style>