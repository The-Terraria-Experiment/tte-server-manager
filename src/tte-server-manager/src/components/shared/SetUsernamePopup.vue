<template>
	<Popup 
		:open="setUsernamePopupOpen" 
		@xClicked="setUsernamePopupOpen = false"
		headerText="Set Username"
		:xDisabled="mustCreate"
		bodyClass="w-11/12 sm:w-2/3 md:w-1/2 xl:w-1/3 h-max"
		layer="2"
		:buttons="[
			mustCreate ? { variant: BTN_VARIANT.DANGER, text: 'LOG OUT', onClick: doLogout } : null,
			{ variant: BTN_VARIANT.PRIMARY, text: 'SAVE', onClick: saveUsername }
		]"
		:originalState="updatedUsername"
		:setState="(state) => updatedUsername = state"
		:getOriginalStateUntil="userIsFetched"
	>
		<div class="h-full w-full">
			<h2 v-if="mustCreate" class="text-teal-4 font-main font-semibold w-full text-center p-4">
				Your profile does not have a display name associated with it, please add one:
			</h2>
			<h2 v-else class="text-teal-4 font-main font-semibold w-full text-center p-4">
				Edit your display name:
			</h2>
			<p class="italic font-sub text-gray-7 w-full text-center px-4 text-sm">
				(Note: This name will only be seen by admins{{ mustCreate ? ', and you can change it at any time by clicking on your profile in the upper right.' : '' }})
			</p>
			<p class="italic font-sub text-gray-7 w-full text-center px-4 text-sm mt-2">
				Please use the same name you use in other places.
			</p>

			<div class="flex justify-center w-full py-4 mt-2 md:mt-10 mb-6">
				<ValueInput placeholder="Enter username" v-model="updatedUsername" maxlength="25" />
			</div>
		</div>
	</Popup>
</template>

<script>
import Popup from '../common/Popup.vue';
import { useUserStore } from '../../stores/userStore';
import { BTN_VARIANT } from '../../util/constants';
import ValueInput from '../common/ValueInput.vue';
import { post } from '../../util/api';
import { PERMISSIONS } from '../../util/permissionValues';

export default {
	components: {
		Popup,
		ValueInput,
	},
	props: {
		mustCreate: {
			type: Boolean,
			default: false
		}
	},
	data() {
		return {
			BTN_VARIANT,
			setUsernamePopupOpen: false,
			updatedUsername: "",
			userIsFetched: false,
		}
	},
	computed: {
		userStore() {
			return useUserStore();
		},
		// Recompute the auto-open decision whenever any input to it changes, so the popup
		// appears the moment a first-time user finishes signing in - not only after a refresh.
		autoOpenKey() {
			return [
				this.userStore.isAuthenticated,
				this.userStore.user?.displayName,
				this.userStore.permissions.length,
			].join("|");
		},
	},
	watch: {
		autoOpenKey() {
			this.maybeAutoOpen();
		},
	},
	methods: {
		openPopup() {
			this.setUsernamePopupOpen = true;
		},
		// The mustCreate instance (rendered globally in App.vue) is responsible for prompting
		// a signed-in user with no display name. App.vue's created() only fires this on a full
		// load, which an in-app email login never triggers, so drive it from store state here.
		// Gated on `access` to match App.vue, which shows a "no access" warning instead.
		maybeAutoOpen() {
			if (!this.mustCreate) return;
			if (!this.userStore.isAuthenticated) return;
			if (!this.$checkPermissions(PERMISSIONS.access)) return;
			if (this.userStore.user?.displayName) return;
			this.openPopup();
		},
		async saveUsername() {
			if (!this.updatedUsername) {
				this.$alert.error("Please enter a display name");
				return;
			}

			try {
				const response = await post("/users/username", PERMISSIONS.access, {
					username: this.updatedUsername
				});
				this.setUsernamePopupOpen = false;
				sessionStorage.clear();
				this.$alert.success("Display name saved");
				await this.userStore.loadUser(true);
				this.updatedUsername = this.userStore.user.displayName;
			} catch (e) {
				this.$alert.error("Error saving display name. Please try again.");
			}
		},
		async doLogout() {
			sessionStorage.clear();
			await this.userStore.signOut();
			// Email sign-out doesn't reload the page, so close this popup and route away
			// ourselves - otherwise it stays open over a logged-out app until a refresh.
			this.setUsernamePopupOpen = false;
			this.$router.push("/");
		}
	},
	async mounted() {
		await this.userStore.ensureUserFetched();
		this.updatedUsername = this.userStore.user?.displayName || "";
		await this.$nextTick();
		this.userIsFetched = true;
		this.maybeAutoOpen();
	}
}
</script>

<style scoped>

</style>