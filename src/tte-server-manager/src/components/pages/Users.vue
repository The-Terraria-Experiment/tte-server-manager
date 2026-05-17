<template>
	<div class="flex flex-col gap-4 sm:gap-8">
		<UserPermissions 
			:loading="loading" 
			:allPermissionData="allPermissionData" 
			@refreshAll="fetchUserPermissions" 
		/>
		
		<UserResourceAccess 
			:loading="loading" 
			:allPermissionData="allPermissionData" 
			@refresh="fetchUserPermissions"
			@saving="loading.save = $event"
		/>
	</div>
</template>

<script>
import { useUserStore } from '../../stores/userStore';
import { get } from '../../util/api';
import { PERMISSIONS } from '../../util/permissionValues';
import { BTN_VARIANT } from '../../util/constants';
import UserPermissions from './tools/users/UserPermissions.vue';
import UserResourceAccess from './tools/users/UserResourceAccess.vue';

export default {
	components: {
		UserPermissions,
		UserResourceAccess,
	},
	props: {

	},
	data() {
		return {
			userStore: useUserStore(),
			loading: {
				permissions: false,
				instances: false,
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