<template>
	<StatusTile
		:permRequired="PERMISSIONS.users.permissions.read"
		:loading="loading"
	>
		<template #header>
			<Icon icon="patreon" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Patreon Tiers</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<PatreonTierMapEditorPopup
					:open="!!editingEntry"
					:entry="editingEntry"
					:disabled="!userStore.hasPermission(PERMISSIONS.users.permissions.write)"
					:loading="entryActionLoading"
					@cancel="editingEntry = null"
					@apply="onApplyEntry"
					@delete="onDeleteEntry"
				/>

				<div class="flex flex-wrap gap-4">
					<div
						v-for="entry in entries"
						:key="entry.tierId"
						class="rounded-lg p-4 w-full sm:w-64 cursor-pointer hover:bg-gray-2 border border-gray-5 bg-gray-4"
						@click="editingEntry = entry"
					>
						<p class="font-bold text-lg text-teal-4 break-all">{{ entry.tierName || entry.tierId }}</p>
						<p class="mt-1 font-mono text-sm text-gray-7">Tier ID: {{ entry.tierId }}</p>
						<p class="mt-2 font-mono text-sm text-white-0">Grants role: {{ roleName(entry.roleId) }}</p>
					</div>
				</div>

				<div
					class="flex items-center mt-4 cursor-pointer bg-gray-4 hover:bg-gray-5 rounded w-max p-2"
					v-if="userStore.hasPermission(PERMISSIONS.users.permissions.write)"
					@click="editingEntry = { tierId: null, tierName: '', roleId: '' }"
				>
					<Icon icon="plus" size="4" color="text-white-0" />
					<p class="ml-2 font-main font-semibold text-sm text-white-0">ADD TIER MAPPING</p>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useUserStore } from '../../../../stores/userStore';
import { usePatreonTierMapStore } from '../../../../stores/patreonTierMapStore';
import { useRolesStore } from '../../../../stores/rolesStore';
import { post } from '../../../../util/api';
import { PERMISSIONS } from '../../../../util/permissionValues';
import PatreonTierMapEditorPopup from './PatreonTierMapEditorPopup.vue';

export default {
	mixins: [],
	components: {
		PatreonTierMapEditorPopup,
	},
	props: {},
	data() {
		return {
			userStore: useUserStore(),
			tierMapStore: usePatreonTierMapStore(),
			rolesStore: useRolesStore(),
			PERMISSIONS,
			editingEntry: null,
			entryActionLoading: {
				save: false,
				delete: false,
			},
		}
	},
	computed: {
		entries() {
			return this.tierMapStore.entries;
		},
		loading() {
			return this.tierMapStore.loading;
		}
	},
	methods: {
		roleName(roleId) {
			return this.rolesStore.roles.find((role) => role.roleId === roleId)?.name || "(unknown role)";
		},
		async onApplyEntry({ tierId, tierName, roleId }) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

			if (this.entryActionLoading.save) return;
			this.entryActionLoading.save = true;

			try {
				await post("/system/patreon/tiermap", PERMISSIONS.users.permissions.write, { tierId, tierName, roleId });
				this.$alert.success("Tier mapping saved");
				this.editingEntry = null;
			} catch (e) {
				this.$alert.error("Error saving tier mapping");
				console.error(e);
				this.entryActionLoading.save = false;
				return;
			}

			try {
				await this.tierMapStore.fetchTierMap();
			} catch (e) {
				this.$alert.error("Error refreshing tier mappings");
				console.error(e);
			} finally {
				this.entryActionLoading.save = false;
			}
		},
		async onDeleteEntry({ tierId }) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

			if (this.entryActionLoading.delete) return;
			this.entryActionLoading.delete = true;

			try {
				await post("/system/patreon/tiermap/delete", PERMISSIONS.users.permissions.write, { tierId });
				this.$alert.success("Tier mapping removed");
				this.editingEntry = null;
			} catch (e) {
				this.$alert.error("Error removing tier mapping");
				console.error(e);
				this.entryActionLoading.delete = false;
				return;
			}

			try {
				await this.tierMapStore.fetchTierMap();
			} catch (e) {
				this.$alert.error("Error refreshing tier mappings");
				console.error(e);
			} finally {
				this.entryActionLoading.delete = false;
			}
		}
	},
	mounted() {
		if (this.$checkPermissions(PERMISSIONS.users.permissions.read)) {
			this.tierMapStore.fetchTierMap();
			this.rolesStore.fetchRoles();
		}
	}
}
</script>

<style scoped>

</style>
