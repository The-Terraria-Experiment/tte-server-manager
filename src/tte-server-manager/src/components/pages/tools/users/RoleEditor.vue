<template>
	<StatusTile
		:permRequired="PERMISSIONS.users.permissions.read"
		:loading="loading"
	>
		<template #header>
			<Icon icon="file-lines" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Roles</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<RoleEditorPopup
					:open="!!editingRole"
					:role="editingRole"
					:disabled="!userStore.hasPermission(PERMISSIONS.users.permissions.write)"
					:loading="roleActionLoading"
					@cancel="editingRole = null"
					@apply="onApplyRole"
					@delete="onDeleteRole"
				/>

				<div class="flex flex-wrap gap-4">
					<div
						v-for="role in roles"
						:key="role.roleId"
						class="rounded-lg p-4 w-full sm:w-64 cursor-pointer hover:bg-gray-2 border border-gray-5 bg-gray-4"
						@click="editingRole = role"
					>
						<div class="flex items-start justify-between">
							<div class="flex items-center min-w-0">
								<span
									v-if="role.color"
									class="h-3 w-3 rounded-full shrink-0 mr-2"
									:style="{ backgroundColor: role.color }"
								></span>
								<p class="font-bold text-lg text-teal-4 leading-5">{{ role.name }}</p>
							</div>
							<!-- <Icon icon="edit" color="text-white-1" size="5" class="shrink-0 ml-2" @click.stop="editingRole = role" /> -->
						</div>
						<div class="mt-2 font-mono text-sm text-white-0">
							<p v-for="line in summaryLines(role).shown" :key="line">{{ line }}</p>
							<p v-if="summaryLines(role).hiddenCount" class="text-gray-7 italic mt-2">... {{ summaryLines(role).hiddenCount }} more</p>
						</div>
					</div>
				</div>

				<div
					class="flex items-center mt-4 cursor-pointer bg-gray-4 hover:bg-gray-5 rounded w-max p-2"
					v-if="userStore.hasPermission(PERMISSIONS.users.permissions.write)"
					@click="editingRole = { roleId: null, name: '', color: '', permissions: [], resourceAccess: [] }"
				>
					<Icon icon="plus" size="4" color="text-white-0" />
					<p class="ml-2 font-main font-semibold text-sm text-white-0">ADD ROLE</p>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useUserStore } from '../../../../stores/userStore';
import { useRolesStore } from '../../../../stores/rolesStore';
import { post } from '../../../../util/api';
import { PERMISSIONS } from '../../../../util/permissionValues';
import { PermissionsMeta } from '../../../../util/permissionsMeta';
import { summarizeRolePermissions } from '../../../../util/rolePermissions';
import RoleEditorPopup from './RoleEditorPopup.vue';

const MAX_SUMMARY_LINES = 5;

export default {
	mixins: [],
	components: {
		RoleEditorPopup,
	},
	props: {},
	data() {
		return {
			userStore: useUserStore(),
			rolesStore: useRolesStore(),
			PERMISSIONS,
			editingRole: null,
			roleActionLoading: {
				save: false,
				delete: false,
			},
		}
	},
	computed: {
		roles() {
			return this.rolesStore.roles;
		},
		loading() {
			return this.rolesStore.loading;
		}
	},
	methods: {
		summaryLines(role) {
			const lines = summarizeRolePermissions(role.permissions || [], PermissionsMeta);
			if (role.resourceAccess?.length) {
				lines.push(`+ ${role.resourceAccess.length} resource grant${role.resourceAccess.length === 1 ? '' : 's'}`);
			}
			return {
				shown: lines.slice(0, MAX_SUMMARY_LINES),
				hiddenCount: Math.max(0, lines.length - MAX_SUMMARY_LINES),
			};
		},
		async onApplyRole({ roleId, name, color, permissions, resourceAccess }) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

			if (this.roleActionLoading.save) return;
			this.roleActionLoading.save = true;

			try {
				await post("/system/roles", PERMISSIONS.users.permissions.write, { roleId, name, color, permissions, resourceAccess });
				this.$alert.success("Role saved");
				this.editingRole = null;
			} catch (e) {
				this.$alert.error("Error saving role");
				console.error(e);
				this.roleActionLoading.save = false;
				return;
			}

			try {
				await this.rolesStore.fetchRoles();
			} catch (e) {
				this.$alert.error("Error refreshing roles");
				console.error(e);
			} finally {
				this.roleActionLoading.save = false;
			}
		},
		async onDeleteRole({ roleId }) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

			if (this.roleActionLoading.delete) return;
			this.roleActionLoading.delete = true;

			try {
				await post("/system/roles/delete", PERMISSIONS.users.permissions.write, { roleId });
				this.$alert.success("Role deleted");
				this.editingRole = null;
			} catch (e) {
				this.$alert.error("Error deleting role");
				console.error(e);
				this.roleActionLoading.delete = false;
				return;
			}

			try {
				await this.rolesStore.fetchRoles();
			} catch (e) {
				this.$alert.error("Error refreshing roles");
				console.error(e);
			} finally {
				this.roleActionLoading.delete = false;
			}
		}
	},
	mounted() {
		if (this.$checkPermissions(PERMISSIONS.users.permissions.read)) {
			this.rolesStore.fetchRoles();
		}
	}
}
</script>

<style scoped>

</style>
