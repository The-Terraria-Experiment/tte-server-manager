<template>
	<StatusTile
		:permRequired="PERMISSIONS.system.instances.list.read"
		:loading="loading"
		collapsible
	>
		<template #header>
			<Icon icon="server" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Instance Registry</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<InstanceRegistryEditorPopup
					:open="!!editingEntry"
					:entry="editingEntry"
					:environments="environments"
					:disabled="!userStore.hasPermission(PERMISSIONS.system.instances.list.write)"
					:loading="entryActionLoading"
					@cancel="editingEntry = null"
					@apply="onApplyEntry"
					@delete="onDeleteEntry"
				/>

				<p class="mb-4 text-sm text-gray-7">
					Which EC2 instances this site manages, and which environments each one appears in.
					Changes take effect within a minute.
				</p>

				<div class="flex flex-wrap gap-4">
					<div
						v-for="entry in entries"
						:key="entry.id"
						class="rounded-lg p-4 w-full sm:w-64 cursor-pointer hover:bg-gray-2 border bg-gray-4"
						:class="entry.missing ? 'border-red-4' : 'border-gray-5'"
						@click="editingEntry = entry"
					>
						<p class="font-bold text-lg text-teal-4 break-all">{{ entry.name }}</p>
						<p class="mt-1 font-mono text-sm text-gray-7 break-all">{{ entry.id }}</p>

						<div class="mt-2 flex flex-wrap items-center gap-1">
							<span
								v-for="env in entry.envs"
								:key="env"
								class="rounded bg-gray-2 px-2 py-0.5 font-mono text-xs uppercase text-white-0"
							>{{ env }}</span>
							<span
								v-if="!entry.envs.length"
								class="rounded bg-gray-2 px-2 py-0.5 font-mono text-xs uppercase text-gray-7"
							>no environments</span>
						</div>

						<div class="mt-2 flex items-center">
							<Icon v-if="entry.missing" icon="warning" color="text-red-3" size="4" />
							<p
								class="font-mono text-sm"
								:class="entry.missing ? 'ml-1 text-red-3' : 'text-white-0'"
							>{{ entry.missing ? 'NOT FOUND IN EC2' : entry.state }}</p>
						</div>
					</div>
				</div>

				<div
					class="flex items-center mt-4 cursor-pointer bg-gray-4 hover:bg-gray-5 rounded w-max p-2"
					v-if="userStore.hasPermission(PERMISSIONS.system.instances.list.write)"
					@click="editingEntry = { id: null, envs: [] }"
				>
					<Icon icon="plus" size="4" color="text-white-0" />
					<p class="ml-2 font-main font-semibold text-sm text-white-0">ADD INSTANCE</p>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useUserStore } from '@/stores/userStore';
import { useInstanceRegistryStore } from '@/stores/instanceRegistryStore';
import { post, put } from '@/util/api';
import { PERMISSIONS } from '@/util/permissionValues';
import InstanceRegistryEditorPopup from './InstanceRegistryEditorPopup.vue';

export default {
	mixins: [],
	components: {
		InstanceRegistryEditorPopup,
	},
	props: {},
	data() {
		return {
			userStore: useUserStore(),
			registryStore: useInstanceRegistryStore(),
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
			return this.registryStore.entries;
		},
		environments() {
			return this.registryStore.environments;
		},
		loading() {
			return this.registryStore.loading;
		}
	},
	methods: {
		async onApplyEntry({ instanceId, envs, isNew }) {
			this.$validatePermissions(PERMISSIONS.system.instances.list.write);

			if (this.entryActionLoading.save) return;
			this.entryActionLoading.save = true;

			try {
				if (isNew) {
					await post("/instances/registry", PERMISSIONS.system.instances.list.write, { instanceId, envs });
				} else {
					await put(`/instances/registry/${instanceId}`, PERMISSIONS.system.instances.list.write, { envs });
				}
				this.$alert.success("Instance registration saved");
				this.editingEntry = null;
			} catch (e) {
				this.$alert.error(e?.message || "Error saving instance registration");
				console.error(e);
				this.entryActionLoading.save = false;
				return;
			}

			await this.refresh();
			this.entryActionLoading.save = false;
		},
		async onDeleteEntry({ instanceId }) {
			this.$validatePermissions(PERMISSIONS.system.instances.list.write);

			if (this.entryActionLoading.delete) return;
			this.entryActionLoading.delete = true;

			try {
				await post(`/instances/registry/${instanceId}/delete`, PERMISSIONS.system.instances.list.write, {});
				this.$alert.success("Instance removed from the registry");
				this.editingEntry = null;
			} catch (e) {
				this.$alert.error(e?.message || "Error removing instance");
				console.error(e);
				this.entryActionLoading.delete = false;
				return;
			}

			await this.refresh();
			this.entryActionLoading.delete = false;
		},
		async refresh() {
			try {
				await this.registryStore.fetchRegistry();
			} catch (e) {
				this.$alert.error("Error refreshing the instance registry");
				console.error(e);
			}
		}
	},
	mounted() {
		if (this.$checkPermissions(PERMISSIONS.system.instances.list.read)) {
			this.refresh();
		}
	}
}
</script>

<style scoped>

</style>
