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
		<a href="https://server.theterrariaexperiment.com/terms-and-conditions-privacy-policy">Terms / Privacy Policy</a>
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
import { useRealtimeStore } from './stores/realtimeStore';
import MajorLoader from './components/shared/MajorLoader.vue';
import GlobalNoticePopup from './components/shared/GlobalNoticePopup.vue';
import { PERMISSIONS } from "@/util/permissionValues";

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
		realtimeStore() {
			return useRealtimeStore();
		},
	},
	methods: {

	},
	async created() {
		this.userDataIsLoading = true;
		// this.userStore.loadUser(); // Don't need to load here because the Router does it, but leaving it here just in case

		await this.userStore.ensureUserFetched();
		this.userDataIsLoading = false;
		if (!this.$checkPermissions(PERMISSIONS.access) && this.userStore.isAuthenticated) {
			this.$alert.warning(`You have not been granted site access.
			If you believe this is in error, please contact Experiment or Havoc in Discord.`, {duration: 0});;
		} else if (!this.userStore.user.displayName) {
			this.$refs.namepopup.openPopup();
		}

		// Opened here rather than in the router guard so it happens once per page load instead of once
		// per navigation, and only after the session (and therefore a usable token) is guaranteed.
		// Deliberately not awaited: the socket is optional, and nothing below it should wait on a
		// connection that may never succeed.
		if (this.userStore.isAuthenticated) {
			this.realtimeStore.connect();
		}
	},
	mounted() {
		if (window.location.host.includes("click")) {
			this.$alert.warning("You are currently using the old site URL, which will be shut down soon. Please go to server.theterrariaexperiment.com instead.", { duration: 0 });
		}
	},
	beforeUnmount() {
		// Cosmetic in practice — the socket dies with the page — but it keeps the store's lifecycle
		// legible and matters for hot reloads in dev.
		this.realtimeStore.disconnect();
	}
}
</script>

<style scoped>

</style>