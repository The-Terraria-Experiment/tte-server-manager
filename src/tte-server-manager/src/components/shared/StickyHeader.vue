<template>
	<div class="flex rounded-b-2xl md:rounded-none overflow-hidden">
		<div class="h-14 md:h-16 grow bg-gray-3 md:bg-linear-to-r from-gray-3 to-gray-5 from-50% md:rounded-br-3xl flex items-center">
			<p v-if="isMobile" class="font-main font-semibold text-cream ml-4 text-lg">SERVER MANAGER</p>
			<p v-else class="font-main font-semibold text-cream text-xl ml-4">SERVER MANAGEMENT DASHBOARD</p>
		</div>

		<BevelCurve v-if="!isMobile" color="text-gray-5" size="6" />

		<div class="bg-gray-3 md:bg-transparent flex items-center md:items-start">
			<FlexButton 
				v-if="!userStore.isAuthenticated"
				class="text-cream bg-linear-to-r from-teal-4 to-teal-1 mr-2 md:mr-6 md:mt-4" 
				@click="goToLogin"
			>
				<p class="font-main font-bold py-2 px-4 md:px-14">LOG IN</p>
			</FlexButton>
			<FlexButton 
				v-else
				class="text-cream bg-linear-to-r from-red-4 to-red-1 mr-2 md:mr-6 md:mt-4" 
				@click="handleSignOut"
			>
				<p class="font-main font-bold py-2 px-4 md:px-14">LOG OUT</p>
			</FlexButton>
		</div>
	</div>
</template>

<script>
import screen from '../../mixins/screen'
import BevelCurve from '../common/BevelCurve.vue';
import FlexButton from '../common/FlexButton.vue';
import { useUserStore } from '../../stores/userStore';
import { useRouter } from 'vue-router';
	
export default {
	mixins: [screen],
	components: {
		BevelCurve,
		FlexButton,
	},
	setup() {
		const userStore = useUserStore();
		const router = useRouter();
		
		// Load user on component mount
		userStore.loadUser();
		
		return { userStore, router };
	},
	methods: {
		goToLogin() {
			this.router.push('/login');
		},
		async handleSignOut() {
			await this.userStore.signOut();
			this.router.push('/');
		}
	}
}
</script>