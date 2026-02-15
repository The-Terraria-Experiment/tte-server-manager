<template>
	<Popup
		:open="popupOpen"
		@xClicked="popupOpen = false"
		headerText="Notice"
		:xDisabled="!baseStore.siteEnabled && !$checkPermissions(PERMISSIONS.system.notice.bypass)"
		bodyClass="w-11/12 md:w-1/3 h-2/3"
		layer="2"
	>
		<div class="h-full w-full flex flex-col justify-center items-center font-main gap-4">
			<p v-if="!baseStore.siteEnabled" class="font-bold text-red-4">The site is currently disabled for access</p>
			<p class="text-white-0 italic">{{ baseStore.globalNotice || "(No message provided)" }}</p>
		</div>
	</Popup>
</template>

<script>
import { useBaseStore } from '../../stores/baseStore';
import { useUserStore } from '../../stores/userStore';
import { PERMISSIONS } from '../../util/permissionValues';
import Popup from '../common/Popup.vue';


export default {
	mixins: [],
	components: {
		Popup,
	},
	props: {
		
	},
	data() {
		return {
			userStore: useUserStore(),
			baseStore: useBaseStore(),
			popupOpen: false,
			PERMISSIONS,
		}
	},
	computed: {
		
	},
	methods: {
		
	},
	async mounted() {
		await this.userStore.ensureUserFetched();
		if (this.baseStore.globalNotice || !this.baseStore.siteEnabled) {
			this.popupOpen = true;
		}
	}
}
</script>

<style scoped>

</style>
