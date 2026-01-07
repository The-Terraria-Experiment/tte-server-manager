<template>
	<AlertStack />

	<div v-if="$route.path === '/login'">
		<RouterView />
	</div>
	<div v-else>
		<StickyHeader />

		<div v-if="isMobile">
			<div class="p-4 w-full pb-20">
				<RouterView />
			</div>
			<MobileNav />
		</div>
		<div v-else class="flex w-full h-max pt-16">
			<DesktopNav />
			<div class="pl-30 p-8 w-full">
				<RouterView />	
			</div>
		</div>

		<SetUsernamePopup ref="namepopup" mustCreate />
	</div>
</template>

<script>
import DesktopNav from './components/shared/DesktopNav.vue';
import MobileNav from './components/shared/MobileNav.vue';
import StickyHeader from './components/shared/StickyHeader.vue';
import AlertStack from './components/common/AlertStack.vue';
import screen from './mixins/screen';
import SetUsernamePopup from './components/shared/SetUsernamePopup.vue';
import { useUserStore } from './stores/userStore';

export default {
	mixins: [ screen ],
	components: {
		DesktopNav,
		StickyHeader,
		MobileNav,
		AlertStack,
		SetUsernamePopup,
	},
	data() {
		return {

		}
	},
	computed: {
		userStore() {
			return useUserStore();
		},
	},
	methods: {
		
	},
	async created() {
		this.userStore.loadUser();

		await this.userStore.ensureUserFetched();
		if (!this.userStore.user.displayName) {
			this.$refs.namepopup.openPopup();
		}
	}
}
</script>

<style scoped>

</style>