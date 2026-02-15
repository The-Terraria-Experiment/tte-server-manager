<template>
	<AlertStack />

	<div v-if="$route.path === '/login'">
		<RouterView />
	</div>
	<div v-else>
		<StickyHeader />

		<div v-if="isMobile">
			<div class="p-4 w-full pb-20">
				<MajorLoader v-if="userDataIsLoading" text="Loading user data..." />
				<RouterView />
			</div>
			<MobileNav />
		</div>
		<div v-else class="flex w-full h-max pt-16">
			<DesktopNav />
			<div class="pl-30 p-8 w-full">
				<MajorLoader v-if="userDataIsLoading" text="Loading user data..." />
				<RouterView />	
			</div>
		</div>

		<SetUsernamePopup ref="namepopup" mustCreate />
		<GlobalNoticePopup />
	</div>

	<div 
		v-if="['', '/', '/overview'].includes($route.path)"
		:class="['relative text-center text-blue-400 font-main font-semibold text-xs mt-4 sm:mt-0 sm:mb-4', isMobile ? 'bottom-20' : 'bottom-2']"
	>
		<a href="https://server.terrariaexperiment.click/terms-and-conditions-privacy-policy">Terms / Privacy Policy</a>
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
import MajorLoader from './components/shared/MajorLoader.vue';
import GlobalNoticePopup from './components/shared/GlobalNoticePopup.vue';

export default {
	mixins: [ screen ],
	components: {
		DesktopNav,
		StickyHeader,
		MobileNav,
		AlertStack,
		SetUsernamePopup,
		MajorLoader,
		GlobalNoticePopup,
	},
	data() {
		return {
			userDataIsLoading: false,
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
		this.userDataIsLoading = true;
		this.userStore.loadUser();

		await this.userStore.ensureUserFetched();
		this.userDataIsLoading = false;
		if (!this.userStore.user.displayName) {
			this.$refs.namepopup.openPopup();
		}
	}
}
</script>

<style scoped>

</style>