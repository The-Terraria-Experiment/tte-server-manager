<template>
	<Popup 
		:open="setUsernamePopupOpen" 
		@xClicked="setUsernamePopupOpen = false"
		headerText="Set Username"
		:xDisabled="mustCreate"
		bodyClass="w-full md:w-1/3 h-2/3"
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

			<div class="flex justify-center w-full py-4 mt-2 md:mt-10">
				<ValueInput placeholder="Enter username" v-model="updatedUsername" />
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
	},
	methods: {
		openPopup() {
			this.setUsernamePopupOpen = true;
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
				this.$alert.success("Display name saved");
				await this.userStore.loadUser(true);
				this.updatedUsername = this.userStore.user.displayName;
			} catch (e) {
				this.$alert.error("Error saving display name. Please try again.");
			}
		},
		async doLogout() {
			await this.userStore.signOut();
		}
	},
	async mounted() {
		await this.userStore.ensureUserFetched();
		this.updatedUsername = this.userStore.user.displayName;
		await this.$nextTick();
		this.userIsFetched = true;
	}
}
</script>

<style scoped>

</style>