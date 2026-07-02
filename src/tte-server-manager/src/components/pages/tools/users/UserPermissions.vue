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
					@cancel="editingUser = null"
					@apply="onApplyPermissionEdit"
				/>

				<FuzzyMatchSearch
					class="mb-4 ml-4"
					placeholder="Filter users..."
					:data="sortedPermissionsData"
					comparisonKey="displayName"
					@update="filteredUserData = $event"
					sortResults
				/>

				<div class="flex flex-col gap-1 px-4 pb-4">
					<div
						v-for="(user, idx) of filteredUserData"
						:key="user.userID"
						:class="['flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 rounded cursor-pointer hover:bg-gray-5', idx%2 ? 'bg-gray-3' : 'bg-gray-4']"
						@click="openRoleEditor(user)"
					>
						<p class="font-mono font-semibold text-cream text-nowrap sm:w-48 shrink-0">{{ user.displayName || user.username }}</p>
						<div class="flex flex-wrap items-center gap-2">
							<span
								v-for="role in matchedRoles(user)"
								:key="role.roleId"
								class="rounded-full px-3 py-1 font-mono font-bold text-xs bg-teal-2 text-cream"
							>{{ role.name }}</span>
							<span
								v-if="uncoveredPermissions(user).length"
								class="rounded-full px-3 py-1 font-mono text-xs bg-gray-5 text-gray-9"
								:title="uncoveredPermissions(user).join(', ')"
							>MISC ({{ uncoveredPermissions(user).length }})</span>
							<span
								v-if="!matchedRoles(user).length && !uncoveredPermissions(user).length"
								class="text-gray-7 italic text-xs"
							>No permissions</span>
						</div>
					</div>
					<p v-if="!filteredUserData.length" class="text-gray-7 italic p-3">No users found</p>
				</div>
				<div
					class="w-full flex justify-end p-4"
					v-show="dirtyPermissions"
				>
					<div v-if="!loading.save" class="flex">
						<FlexButton :variant="BTN_VARIANT.DANGER" class="ml-4" @click="discardPermChanges">
							<p class="font-main font-bold py-2 px-8 md:px-12 text-sm">DISCARD</p>
						</FlexButton>
						<FlexButton :variant="BTN_VARIANT.PRIMARY" class="ml-4" @click="savePermChanges">
							<p class="font-main font-bold py-2 px-8 md:px-12 text-sm">SAVE</p>
						</FlexButton>
					</div>
					<div v-else class="flex items-center pr-4">
						<Spinner class="h-4 w-4 text-teal-3" thickness="4" />
						<p class="font-main font-bold text-teal-3 ml-2">Saving...</p>
					</div>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useUserStore } from '../../../../stores/userStore';
import { get, post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import { getMatchedRoles, getUncoveredPermissions } from '../../../../util/rolePermissions';
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
			PERMISSIONS,
			BTN_VARIANT,
			updatedPermissions: {},
			updatedResourceAccess: {},
			dirtyPermissions: false,
			filteredUserData: [],
			editingUser: null,
			roles: [],
			loadingRoles: false,
		}
	},
	computed: {
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
		effectivePermissions(user) {
			return this.updatedPermissions[user.userID] || user.permissions;
		},
		effectiveResourceAccess(user) {
			return this.updatedResourceAccess[user.userID] || user.resourceAccess;
		},
		matchedRoles(user) {
			return getMatchedRoles(this.effectivePermissions(user), this.effectiveResourceAccess(user), this.roles);
		},
		uncoveredPermissions(user) {
			return getUncoveredPermissions(this.effectivePermissions(user), this.effectiveResourceAccess(user), this.roles);
		},
		discardPermChanges() {
			this.updatedPermissions = {};
			this.updatedResourceAccess = {};
			this.dirtyPermissions = false;
		},
		openRoleEditor(user) {
			this.editingUser = {
				...user,
				permissions: new Set(this.effectivePermissions(user)),
				resourceAccess: new Set(this.effectiveResourceAccess(user)),
			};
		},
		onApplyPermissionEdit({ userID, permissions, resourceAccess }) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

			const newPermSet = new Set(permissions);
			const originalPermSet = this.permissionsData[userID].permissions;
			const isPermSameAsOriginal = newPermSet.size === originalPermSet.size && [...newPermSet].every(p => originalPermSet.has(p));

			if (isPermSameAsOriginal) {
				delete this.updatedPermissions[userID];
			} else {
				this.updatedPermissions[userID] = newPermSet;
			}

			const newResourceSet = new Set(resourceAccess);
			const originalResourceSet = this.permissionsData[userID].resourceAccess;
			const isResourceSameAsOriginal = newResourceSet.size === originalResourceSet.size && [...newResourceSet].every(r => originalResourceSet.has(r));

			if (isResourceSameAsOriginal) {
				delete this.updatedResourceAccess[userID];
			} else {
				this.updatedResourceAccess[userID] = newResourceSet;
			}

			this.dirtyPermissions = Object.keys(this.updatedPermissions).length > 0 || Object.keys(this.updatedResourceAccess).length > 0;
			this.editingUser = null;
		},
		async savePermChanges() {
			this.loading.save = true;
			const userIDs = new Set([...Object.keys(this.updatedPermissions), ...Object.keys(this.updatedResourceAccess)]);

			for (const userID of userIDs) {
				try {
					if (this.updatedPermissions[userID]) {
						await post("/users/permissions", PERMISSIONS.users.permissions.write, {
							userID,
							permissions: Array.from(this.updatedPermissions[userID])
						});
					}
					if (this.updatedResourceAccess[userID]) {
						await post("/users/resourcepermissions", PERMISSIONS.users.permissions.write, {
							userID,
							resourceAccess: Array.from(this.updatedResourceAccess[userID])
						});
					}
					this.$alert.success("Permissions saved");
					this.$emit("refreshAll");
				} catch (e) {
					this.$alert.error("Error saving permissions");
					console.error(e);
				}
			}
			this.discardPermChanges();
			this.loading.save = false;
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
		},
		async fetchRoles() {
			if (this.loadingRoles) return;
			this.loadingRoles = true;

			try {
				const response = await get("/system/roles", PERMISSIONS.users.permissions.read);
				this.roles = response.entries || [];
			} catch (e) {
				this.$alert.error("Error fetching roles");
				console.error(e);
			}

			this.loadingRoles = false;
		}
	},
	mounted() {
		this.filteredUserData = this.sortedPermissionsData;

		if (this.$checkPermissions(PERMISSIONS.users.permissions.read)) {
			this.fetchRoles();
		}
	}
}
</script>

<style scoped>

</style>
