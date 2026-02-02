<template>
	<div class="bg-gray-3 fixed bottom-0 h-16 w-full rounded-t-2xl flex justify-around px-4 font-main font-semibold text-cream text-xs mobile-nav-shadow z-10">
		<RouterLink to="/overview" class="w-1/5">
			<FlexButton :class="['flex-col justify-end h-full p-2', selectedClass('/overview')]">
				<Icon icon="gauge" size="5" :color="selectedClass(['', '/', '/overview'])"/>
				<div class="mt-1">OVERVIEW</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/instance" class="w-1/5" v-if="hasInstancePermissions">
			<FlexButton :class="['flex-col justify-end h-full p-2', selectedClass('/instance')]">
				<Icon icon="server" size="6" :color="selectedClass('/instance')"/>
				<div class="mt-1">INSTANCE</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/server" class="w-1/5" v-if="hasServerPermissions">
			<FlexButton :class="['flex-col justify-end h-full p-2', selectedClass('/server')]">
				<Icon icon="gamepad" size="7" :color="selectedClass('/server')"/>
				<div class="mt-0.5">SERVER</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/users" class="w-1/5" v-if="hasUserPermissions">
			<FlexButton :class="['flex-col justify-end h-full p-2', selectedClass('/users')]">
				<Icon icon="user-lock" size="6" :color="selectedClass('/users')"/>
				<div class="mt-1">USERS</div>
			</FlexButton>
		</RouterLink>
	</div>
</template>

<script>
import { PERMISSIONS } from '../../util/permissionValues';
import leaves from '../../util/traverse';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';

export default {
	components: {
		FlexButton,
		Icon,
	},
	data() {
		return {
			PERMISSIONS,
		}
	},
	computed: {
		hasUserPermissions() {
			return this.$checkPermissions(leaves(PERMISSIONS.users), false);
		},
		hasInstancePermissions() {
			return this.$checkPermissions(leaves(PERMISSIONS.instance), false);
		},
		hasServerPermissions() {
			return this.$checkPermissions(leaves(PERMISSIONS.server), false);
		}
	},
	methods: {
		selectedClass(routes) {
			if (!Array.isArray(routes)) {
				routes = [routes];
			}
			if (routes.includes(this.$route.path)) {
				return 'text-cream';
			}
			return 'text-gray-7';
		}
	}
}
</script>

<style scoped>
	@reference "../../theme.css";

.mobile-nav-shadow {
	box-shadow: 0px -5px 15px var(--color-gray-0);
}
</style>