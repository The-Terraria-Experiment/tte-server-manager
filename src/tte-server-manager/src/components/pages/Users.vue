<template>
	<div class="flex flex-col gap-4 sm:gap-8">
		<UserPermissions
			:loading="loading"
			:allPermissionData="allPermissionData"
			@refreshAll="fetchUserPermissions"
		/>

		<RoleEditor />
	</div>
</template>

<script>
import { useUserStore } from '../../stores/userStore';
import { get } from '../../util/api';
import { PERMISSIONS } from '../../util/permissionValues';
import { BTN_VARIANT } from '../../util/constants';
import UserPermissions from './tools/users/UserPermissions.vue';
import RoleEditor from './tools/users/RoleEditor.vue';

export default {
	components: {
		UserPermissions,
		RoleEditor,
	},
	props: {

	},
	data() {
		return {
			userStore: useUserStore(),
			loading: {
				permissions: false,
				save: false,
			},
			PERMISSIONS,
			BTN_VARIANT,
			allPermissionData: null,
		}
	},
	computed: {
		
	},
	methods: {
		async fetchUserPermissions() {
			this.$validatePermissions(PERMISSIONS.users.permissions.read);

			if (this.loading.permissions) return;
			this.loading.permissions = true;

			await this.userStore.ensureUserFetched();

			try {
				const allPermissions = await get("/users/permissions", PERMISSIONS.users.permissions.read);
				this.allPermissionData = allPermissions;
			} catch (e) {
				this.$alert.error("Error fetching permissions");
			}

			this.loading.permissions = false;
		},
	},
	mounted() {
		if (this.$checkPermissions(PERMISSIONS.users.permissions.read)) {
			this.fetchUserPermissions();
		}
	}
}
</script>

<style scoped>

</style>