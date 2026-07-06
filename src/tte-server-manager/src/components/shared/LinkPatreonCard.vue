<template>
	<div class="bg-gray-3 rounded-xl overflow-hidden h-max p-4">
		<h1 class="font-main font-bold text-2xl text-teal-4 mb-4">Patreon</h1>
		<p class="font-main font-semibold text-white-0 mb-4">
			Link your Patreon account so you can sign in with Patreon in the future.
		</p>
		<FlexButton
			:disabled="linking"
			:variant="BTN_VARIANT.PRIMARY"
			@input="startLink"
		>
			<p class="py-2 px-12">LINK PATREON ACCOUNT</p>
		</FlexButton>
	</div>
</template>

<script>
import FlexButton from '../common/FlexButton.vue';
import { post } from '../../util/api';
import { BTN_VARIANT } from '../../util/constants';
import { PERMISSIONS } from '../../util/permissionValues';

export default {
	components: {
		FlexButton,
	},
	data() {
		return {
			BTN_VARIANT,
			linking: false,
		}
	},
	methods: {
		async startLink() {
			if (this.linking) return;
			this.linking = true;

			try {
				const response = await post("/users/patreon/link-start", PERMISSIONS.access);
				window.location.href = response.authorizeUrl;
			} catch (e) {
				this.$alert.error("Failed to start Patreon linking");
				this.linking = false;
			}
		}
	}
}
</script>

<style scoped>

</style>
