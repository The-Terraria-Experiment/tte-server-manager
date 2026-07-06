<template>
	<Popup
		:open="profilePopupOpen"
		@xClicked="profilePopupOpen = false"
		headerText="Profile"
		bodyClass="w-11/12 md:w-1/4 h-3/5 sm:h-2/5 min-h-72 min-w-90"
	>
		<div class="w-full h-full flex flex-col justify-between items-center p-4">
			<div>
				<p class="text-gray-6 font-main font-bold text-center mb-2">Display Name</p>
				<div
					class="rounded-lg bg-gray-4 py-2 px-4 font-main font-bold text-cream min-w-50 cursor-pointer"
					@click="$refs.namepopup.openPopup"
				>
					{{ userStore.user?.displayName || '<No username>' }}
				</div>
			</div>

			<div class="flex flex-col items-center gap-2">
				<p v-if="userStore.isPatreonLinked" class="font-main font-bold text-sm text-gray-6">
					Patreon account linked
				</p>
				<FlexButton
					v-else
					:variant="BTN_VARIANT.SECONDARY"
					@input="startPatreonLink"
					:disabled="linkingPatreon"
				>
					<p v-if="!linkingPatreon" class="">LINK PATREON ACCOUNT</p>
					<div v-else class="flex items-center">
						<Spinner class="h-4 w-4 mr-2" thickness="4" />
						<p class="font-main font-bold">Working...</p>
					</div>
				</FlexButton>
			</div>

			<div class="flex flex-col-reverse sm:flex-row items-center gap-4 mb-4">
				<FlexButton
					class=""
					:variant="BTN_VARIANT.SECONDARY"
					@input="handleClearCache"
					:disabled="loadingClearCache"
				>
					<p v-if="!loadingClearCache" class="">CLEAR CACHE</p>
					<div v-else class="flex items-center">
						<Spinner class="h-5 w-5 mr-2" thickness="4" />
						<p class="font-main font-bold">Working...</p>
					</div>
				</FlexButton>
				<FlexButton
					class=""
					:variant="BTN_VARIANT.DANGER"
					@input="handleSignOut"
					:disabled="logoutClicked"
				>
					<p v-if="!logoutClicked" class="font-main font-bold py-2 px-6 md:px-8">LOG OUT</p>
					<div v-else class="flex items-center px-6 py-2">
						<Spinner class="h-5 w-5 mr-2 text-cream" thickness="4" />
						<p class="font-main font-bold text-cream">Please wait...</p>
					</div>
				</FlexButton>

			</div>
		</div>
	</Popup>

	<SetUsernamePopup ref="namepopup" />
</template>

<script>
import { useUserStore } from '../../stores/userStore';
import { useRouter } from 'vue-router';
import { BTN_VARIANT } from '../../util/constants';
import { PERMISSIONS } from '../../util/permissionValues';
import { post } from '../../util/api';
import Popup from '../common/Popup.vue';
import FlexButton from '../common/FlexButton.vue';
import Spinner from '../common/Spinner.vue';
import SetUsernamePopup from './SetUsernamePopup.vue';

export default {
	components: {
		Popup,
		FlexButton,
		Spinner,
		SetUsernamePopup,
	},
	data() {
		return {
			BTN_VARIANT,
			profilePopupOpen: false,
			logoutClicked: false,
			loadingClearCache: false,
			linkingPatreon: false,
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
	},
	methods: {
		openPopup() {
			this.profilePopupOpen = true;
		},
		async handleSignOut() {
			sessionStorage.clear();
			this.logoutClicked = true;
			await this.userStore.signOut();
			this.router.push('/');
		},
		async handleClearCache() {
			this.loadingClearCache = true;
			sessionStorage.clear();
			await new Promise((res, rej) => setTimeout(res, 500));
			this.loadingClearCache = false;
		},
		async startPatreonLink() {
			if (this.linkingPatreon) return;
			this.linkingPatreon = true;

			try {
				const response = await post("/users/patreon/link-start", PERMISSIONS.access);
				window.location.href = response.authorizeUrl;
			} catch (e) {
				this.$alert.error("Failed to start Patreon linking");
				this.linkingPatreon = false;
			}
		}
	}
}
</script>

<style scoped>

</style>
