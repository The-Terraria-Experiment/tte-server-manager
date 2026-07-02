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
							<p class="font-bold text-lg text-teal-4 break-all">{{ role.name }}</p>
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
					@click="editingRole = { roleId: null, name: '', permissions: [] }"
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
import { get, post } from '../../../../util/api';
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
			PERMISSIONS,
			roles: [],
			loading: false,
			editingRole: null,
		}
	},
	computed: {},
	methods: {
		summaryLines(role) {
			const lines = summarizeRolePermissions(role.permissions || [], PermissionsMeta);
			return {
				shown: lines.slice(0, MAX_SUMMARY_LINES),
				hiddenCount: Math.max(0, lines.length - MAX_SUMMARY_LINES),
			};
		},
		async fetchRoles() {
			if (this.loading) return;
			this.loading = true;

			try {
				const response = await get("/system/roles", PERMISSIONS.users.permissions.read);
				this.roles = response.entries || [];
			} catch (e) {
				this.$alert.error("Error fetching roles");
				console.error(e);
			}

			this.loading = false;
		},
		async onApplyRole({ roleId, name, permissions }) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

			try {
				await post("/system/roles", PERMISSIONS.users.permissions.write, { roleId, name, permissions });
				this.$alert.success("Role saved");
				this.editingRole = null;
				await this.fetchRoles();
			} catch (e) {
				this.$alert.error("Error saving role");
				console.error(e);
			}
		},
		async onDeleteRole({ roleId }) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

			try {
				await post("/system/roles/delete", PERMISSIONS.users.permissions.write, { roleId });
				this.$alert.success("Role deleted");
				this.editingRole = null;
				await this.fetchRoles();
			} catch (e) {
				this.$alert.error("Error deleting role");
				console.error(e);
			}
		}
	},
	mounted() {
		if (this.$checkPermissions(PERMISSIONS.users.permissions.read)) {
			this.fetchRoles();
		}
	}
}
</script>

<style scoped>

</style>
