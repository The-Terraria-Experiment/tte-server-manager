<template>
	<div class="fixed h-full bg-gray-3 flex flex-col justify-center text-cream font-main font-semibold text-xs px-1 w-22">
		<BevelCurve class="absolute -right-8 top-0" color="text-gray-3"/>
		<RouterLink to="/overview" class="-mt-12">
			<FlexButton :class="['flex-col justify-end h-full px-2 py-4', { navBtnSelected: routeActive(['', '/', '/overview']) }]">
				<Icon icon="gauge" size="5" color="text-cream"/>
				<div class="mt-1">OVERVIEW</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/instance">
			<FlexButton :class="['flex-col h-full justify-end px-2 py-4', { navBtnSelected: routeActive('/instance') }]">
				<Icon icon="server" size="6" color="text-cream"/>
				<div class="mt-1">INSTANCE</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/server">
			<FlexButton :class="['flex-col h-full justify-end px-2 py-4', { navBtnSelected: routeActive('/server') }]">
				<Icon icon="gamepad" size="7" color="text-cream"/>
				<div class="mt-0.5">SERVER</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/users">
			<FlexButton :class="['flex-col h-full justify-end px-2 py-4', { navBtnSelected: routeActive('/users') }]">
				<Icon icon="user-lock" size="6" color="text-cream"/>
				<div class="mt-1">USERS</div>
			</FlexButton>
		</RouterLink>
	</div>
</template>

<script>
import BevelCurve from '../common/BevelCurve.vue';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';

export default {
	components: {
		FlexButton,
		Icon,
		BevelCurve,
	},
	methods: {
		routeActive(routes) {
			if (!Array.isArray(routes)) {
				routes = [routes];
			}
			return routes.includes(this.$route.path)
		}
	}
}
</script>

<style scoped>
	@reference "../../theme.css";

	.navBtnSelected{
		@apply bg-linear-to-br from-teal-2 to-teal-0;
	}
</style>