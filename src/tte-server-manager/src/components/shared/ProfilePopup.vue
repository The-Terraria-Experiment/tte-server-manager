<template>
	<Popup
		:open="profilePopupOpen"
		@xClicked="profilePopupOpen = false"
		headerText="Account"
		bodyClass="w-11/12 md:w-1/3 h-3/5 sm:h-2/5 min-h-72 sm:min-w-100"
	>
		<div class="w-full h-full flex flex-col justify-between items-center">
			<div class="flex flex-col w-full gap-2 mt-2">
				<div class="flex items-center justify-between flex-wrap bg-gray-2 py-2 pl-4 pr-2 mx-2 rounded-lg">
					<p class="text-white-0 font-main font-bold text-center mr-12">Display Name</p>
					<div
						class="rounded-lg bg-gray-4 py-2 px-4 font-main font-bold text-cream min-w-50 cursor-pointer my-2 mr-2 sm:my-0 sm:mr-0"
						@click="$refs.namepopup.openPopup"
					>
						{{ userStore.user?.displayName || '<No username>' }}
					</div>
				</div>
				<div :class="['flex items-center justify-between flex-wrap bg-gray-2 mx-2 rounded-lg', userStore.isPatreonLinked ? 'p-4' : 'py-2 pl-4 pr-2']">
					<p class="text-white-0 font-main font-bold text-center">Linked Accounts</p>
					<div v-if="userStore.isPatreonLinked" class="flex items-center">
						<Icon icon="patreon" size="5" color="text-[#f96854]" title="Patreon" />
						<Icon icon="checkmark" size="5" color="text-teal-4" class="ml-2" />
					</div>
					<FlexButton
						v-else
						class="my-2 mr-2 sm:my-0 sm:mr-0"
						:variant="BTN_VARIANT.SECONDARY"
						@input="startPatreonLink"
						:disabled="linkingPatreon || userStore.isPatreonLinked"
					>
						<p v-if="!linkingPatreon" class="">LINK PATREON ACCOUNT</p>
						<div v-else class="flex items-center">
							<Spinner class="h-4 w-4 mr-2" thickness="4" />
							<p class="font-main font-bold">Working...</p>
						</div>
					</FlexButton>
					
				</div>
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
