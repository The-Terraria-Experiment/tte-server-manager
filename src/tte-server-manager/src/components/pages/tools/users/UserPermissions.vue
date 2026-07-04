<template>
	<StatusTile
		:permRequired="PERMISSIONS.users.permissions.read"
	>
		<template #header>
			<Icon icon="key" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">User Permissions</p>
		</template>
		<template #summary>
			<div class="flex flex-col sm:flex-row gap-4">
				<RefreshButton :loading="loading.permissions" @input="$emit('refreshAll')" />
				<FlexButton
					v-if="$checkPermissions(PERMISSIONS.system.dropcache)"
					:variant="BTN_VARIANT.SECONDARY"
					leftIcon="user-slash"
					@input="dropUserPermCache"
				>
					DROP PERM CACHE
				</FlexButton>
			</div>
		</template>
		<template #content>
			<div class="relative z-0">
				<UserRoleEditorPopup
					:open="!!editingUser"
					:user="editingUser"
					:roles="roles"
					:disabled="!userStore.hasPermission(PERMISSIONS.users.permissions.write)"
					:canDelete="canDeleteUser(editingUser)"
					:loading="{ save: loading.save, delete: loading.delete }"
					@cancel="editingUser = null"
					@save="onSavePermissionEdit"
					@delete="onDeleteUser"
				/>

				<FuzzyMatchSearch
					class="mb-4 ml-4"
					placeholder="Filter users..."
					:data="sortedPermissionsData"
					comparisonKey="displayName"
					@update="filteredUserData = $event"
					sortResults
				/>

				<div class="flex flex-col px-4 pb-4">
					<div
						v-for="(user, idx) of filteredUserData"
						:key="user.userID"
						:class="['flex flex-row items-center gap-2 sm:gap-4 p-2 rounded cursor-pointer hover:bg-gray-5', idx%2 ? 'bg-gray-3' : 'bg-gray-4']"
						@click="openRoleEditor(user)"
					>
						<p class="font-mono font-semibold text-cream text-nowrap truncate min-w-0 flex-1 sm:w-1/4 sm:flex-none sm:shrink-0">{{ user.displayName || user.username }}</p>
						<div class="flex sm:hidden items-center justify-end gap-2 shrink-0">
							<span
								class="rounded-full px-3 py-1 font-mono font-bold text-xs bg-teal-2 text-cream shrink-0"
							>{{ matchedRoles(user).length }} role{{ matchedRoles(user).length === 1 ? '' : 's' }} ({{ user.permissions.size }}/{{ user.resourceAccess.size }})</span>
						</div>
						<div class="hidden sm:flex flex-nowrap items-center gap-2 min-w-0 overflow-x-auto">
							<span
								v-for="role in matchedRoles(user)"
								:key="role.roleId"
								:class="[
									'rounded-full px-3 py-1 font-mono font-bold text-xs text-nowrap shrink-0',
									role.color ? roleChipTextClass(role) : 'bg-teal-2 text-cream'
								]"
								:style="roleChipStyle(role)"
							>{{ role.name }}</span>
							<span
								v-if="uncoveredPermissions(user).length"
								class="rounded-full px-3 py-1 font-mono text-xs text-nowrap bg-gray-5 text-gray-9 shrink-0"
								:title="uncoveredPermissions(user).join(', ')"
							>+{{ uncoveredPermissions(user).length }} MISC</span>
							<span
								v-if="!matchedRoles(user).length && !uncoveredPermissions(user).length"
								class="text-gray-7 italic text-xs text-nowrap shrink-0"
							>No permissions</span>
						</div>
					</div>
					<p v-if="!filteredUserData.length" class="text-gray-7 italic p-3">No users found</p>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useUserStore } from '../../../../stores/userStore';
import { useRolesStore } from '../../../../stores/rolesStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import { getMatchedRoles, getUncoveredPermissions } from '../../../../util/rolePermissions';
import { getContrastTextClass } from '../../../../util/color';
import RefreshButton from '../../../common/RefreshButton.vue';
import FuzzyMatchSearch from '../../../common/FuzzyMatchSearch.vue';
import UserRoleEditorPopup from './UserRoleEditorPopup.vue';


export default {
	mixins: [],
	components: {
		RefreshButton,
		FuzzyMatchSearch,
		UserRoleEditorPopup,
	},
	props: {
		loading: {
			type: Object,
			required: true
		},
		allPermissionData: {
			type: [Object, null],
			required: true
		}
	},
	data() {
		return {
			userStore: useUserStore(),
			rolesStore: useRolesStore(),
			PERMISSIONS,
			BTN_VARIANT,
			filteredUserData: [],
			editingUser: null,
		}
	},
	computed: {
		roles() {
			return this.rolesStore.roles;
		},
		sortedPermissionsData() {
			return Object.values(this.permissionsData)
				.sort((a, b) => (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', undefined, { numeric: true }));
		},
		permissionsData() {
			if (!this.allPermissionData) return [];

			return	Object.fromEntries((this.allPermissionData.entries || [])
				.map(udata => [udata.userID, { ...udata, permissions: new Set(udata.permissions), resourceAccess: new Set(udata.resourceAccess) }])
				.sort((a, b) => (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', undefined, { numeric: true })));
		},
	},
	methods: {
		matchedRoles(user) {
			return getMatchedRoles(user.permissions, user.resourceAccess, this.roles);
		},
		uncoveredPermissions(user) {
			return getUncoveredPermissions(user.permissions, user.resourceAccess, this.roles);
		},
		roleChipStyle(role) {
			return role.color ? { backgroundColor: role.color } : {};
		},
		roleChipTextClass(role) {
			return role.color ? getContrastTextClass(role.color) : 'text-cream';
		},
		openRoleEditor(user) {
			this.editingUser = user;
		},
		canDeleteUser(user) {
			if (!user) return false;
			if (!this.userStore.hasPermission(PERMISSIONS.users.delete)) return false;

			const ownUid = this.userStore.user?.userId ? `user#${this.userStore.user.userId}` : null;
			return user.userID !== ownUid;
		},
		async onSavePermissionEdit({ userID, permissions, resourceAccess }) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

			if (this.loading.save) return;
			this.loading.save = true;

			const newPermSet = new Set(permissions);
			const originalPermSet = this.permissionsData[userID].permissions;
			const permsChanged = newPermSet.size !== originalPermSet.size || [...newPermSet].some(p => !originalPermSet.has(p));

			const newResourceSet = new Set(resourceAccess);
			const originalResourceSet = this.permissionsData[userID].resourceAccess;
			const resourceChanged = newResourceSet.size !== originalResourceSet.size || [...newResourceSet].some(r => !originalResourceSet.has(r));

			try {
				if (permsChanged) {
					await post("/users/permissions", PERMISSIONS.users.permissions.write, {
						userID,
						permissions: Array.from(newPermSet)
					});
				}
				if (resourceChanged) {
					await post("/users/resourcepermissions", PERMISSIONS.users.permissions.write, {
						userID,
						resourceAccess: Array.from(newResourceSet)
					});
				}
				this.$alert.success("Permissions saved");
				this.editingUser = null;
			} catch (e) {
				this.$alert.error("Error saving permissions");
				console.error(e);
				this.loading.save = false;
				return;
			}

			this.$emit("refreshAll");
			this.loading.save = false;
		},
		async onDeleteUser({ userID }) {
			this.$validatePermissions(PERMISSIONS.users.delete);

			if (this.loading.delete) return;
			this.loading.delete = true;

			try {
				await post("/users/delete", PERMISSIONS.users.delete, { userID });
				this.$alert.success("User deleted");
				this.editingUser = null;
			} catch (e) {
				this.$alert.error("Error deleting user");
				console.error(e);
				this.loading.delete = false;
				return;
			}

			this.$emit("refreshAll");
			this.loading.delete = false;
		},
		async dropUserPermCache() {
			this.$validatePermissions(PERMISSIONS.system.dropcache);

			try {
				await post("/users/dropcache", PERMISSIONS.system.dropcache);
				this.$alert.success("Permission cache dropped");
			} catch (e) {
				this.$alert.error("Error dropping permission cache");
				console.error(e);
			}
		}
	},
	mounted() {
		this.filteredUserData = this.sortedPermissionsData;

		if (this.$checkPermissions(PERMISSIONS.users.permissions.read)) {
			this.rolesStore.fetchRoles();
		}
	}
}
</script>

<style scoped>

</style>
