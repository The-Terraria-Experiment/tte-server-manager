<template>
	<div class="flex rounded-b-2xl md:rounded-none overflow-hidden sm:fixed sm:w-full z-chrome shadow-lg shadow-gray-1">
		<div class="h-14 md:h-16 grow bg-gray-3 md:bg-linear-to-r from-gray-3 to-gray-5 from-50%  flex items-center">
			<p v-if="isMobile" class="font-main font-semibold text-cream ml-4 text-lg">SERVER MANAGER</p>
			<p v-else class="font-main font-semibold text-cream text-xl ml-4">SERVER MANAGEMENT DASHBOARD</p>
		</div>

		<div v-if="!isMobile" class="h-16 w-6 bg-gray-5 z-10 rounded-br-3xl"></div>

		<BevelCurve v-if="!isMobile" color="text-gray-5" size="6" class="z-10" />

		<div class="bg-gray-3 md:bg-gray-1 md:-ml-12 md:pl-12 flex items-center md:items-start" title="Profile">
			<FlexButton 
				v-if="!userStore.isAuthenticated"
				class="mr-2 md:mr-6 md:mt-4" 
				:variant="BTN_VARIANT.PRIMARY"
				@click="goToLogin"
			>
				<p class="font-main font-bold py-2 px-4 md:px-14">LOG IN</p>
			</FlexButton>
			<div
				v-else
				class="h-10 w-10 rounded-full bg-linear-to-br from-teal-4 to-red-1 sm:mt-4 mr-4 flex justify-center items-center cursor-pointer"
				@click="$refs.profilePopup.openPopup()"
			>
				<p class="font-main font-black text-cream">
					{{ profileLetter }}
				</p>
			</div>
		</div>

		<ProfilePopup ref="profilePopup" />
	</div>
</template>

<script>
import screen from '../../mixins/screen'
import BevelCurve from '../common/BevelCurve.vue';
import FlexButton from '../common/FlexButton.vue';
import { useUserStore } from '../../stores/userStore';
import { useRouter } from 'vue-router';
import { BTN_VARIANT } from '../../util/constants';
import ProfilePopup from './ProfilePopup.vue';

export default {
	mixins: [screen],
	components: {
		BevelCurve,
		FlexButton,
		ProfilePopup,
	},
	data() {
		return {
			BTN_VARIANT,
		}
	},
	setup() {
		const router = useRouter();

		return { router };
	},
	computed: {
		userStore() {
			return useUserStore();
		},
		profileLetter() {
			return (this.userStore.user.displayName || this.userStore.username || "TTE_USER").split("")[0];
		}
	},
	methods: {
		goToLogin() {
			this.router.push('/login');
		}
	}
}
</script>