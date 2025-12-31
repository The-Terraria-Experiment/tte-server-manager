<template>
	<AlertStack />
	<div v-if="$route.path === '/login'">
		<RouterView />
	</div>
	<div v-else>
		<StickyHeader />

		<div v-if="isMobile">
			<div class="p-4 w-full">
				<RouterView />
			</div>
			<MobileNav />
		</div>
		<div v-else class="flex w-full h-max">
			<DesktopNav />
			<div class="pl-30 p-8 w-full">
				<RouterView />	
			</div>
		</div>
	</div>
</template>

<script>
import DesktopNav from './components/shared/DesktopNav.vue';
import MobileNav from './components/shared/MobileNav.vue';
import StickyHeader from './components/shared/StickyHeader.vue';
import AlertStack from './components/common/AlertStack.vue';
import screen from './mixins/screen';
import { useUserStore } from './stores/userStore';

export default {
	mixins: [ screen ],
	components: {
		DesktopNav,
		StickyHeader,
		MobileNav,
		AlertStack,
	},
	computed: {
		userStore() {
			return useUserStore();
		},
	},
	created() {
		this.userStore.loadUser();
	}
}
</script>

<style scoped>

</style>