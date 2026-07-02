<template>
	<div>
		<div v-if="loadingInstances" class="flex items-center">
			<Spinner class="h-4 w-4 text-gray-8" thickness="4" />
			<p class="font-main font-bold text-gray-8 ml-2">Loading...</p>
		</div>
		<div v-else class="flex flex-col sm:grid grid-cols-2 gap-2">
			<div v-for="def in ResourceDefinitions" :key="def.key" class="bg-[#252525] p-4 rounded">
				<p class="font-bold uppercase">{{ def.groupLabel }}</p>
				<CheckboxList
					class="mt-2"
					:nodes="resourceGroups[def.key] || []"
					@update:nodes="onGroupUpdate(def.key, $event)"
				>
					<template #default="{ payload }">
						<span class="font-mono cursor-default">{{ payload.label }}</span>
					</template>
				</CheckboxList>
				<p v-if="!(resourceGroups[def.key] || []).length" class="text-gray-7 italic text-sm mt-2">No resources available</p>
			</div>
		</div>
	</div>
</template>

<script>
import CheckboxList from '@/components/common/CheckboxList.vue';
import Spinner from '@/components/common/Spinner.vue';
import { useServerStore } from '@/stores/serverStore';
import { ResourceDefinitions } from '@/util/resourceDefinitions';
import { buildResourceTree, resourceTreeToTokens } from '@/util/resourceTree';
import { mergeTreeUpdates } from '@/util/checkboxTree';


export default {
	mixins: [],
	components: {
		CheckboxList,
		Spinner,
	},
	props: {
		// Currently granted resource token strings for the role/user being edited.
		resourceAccess: {
			type: Array,
			default: () => []
		},
		// When true, every checkbox is rendered read-only.
		disabled: {
			type: Boolean,
			default: false
		}
	},
	emits: ['update:resourceAccess'],
	data() {
		return {
			ResourceDefinitions,
			serverStore: useServerStore(),
			loadingInstances: false,
		}
	},
	computed: {
		resourceGroups() {
			return buildResourceTree(
				ResourceDefinitions,
				{ instances: this.serverStore.instances, instanceFileRoots: this.serverStore.instanceFileRoots },
				this.resourceAccess,
				this.disabled
			);
		}
	},
	methods: {
		onGroupUpdate(groupKey, updatedNodes) {
			if (this.disabled) return;

			const mergedGroupNodes = mergeTreeUpdates(this.resourceGroups[groupKey] || [], updatedNodes);

			const newTokens = [];
			Object.entries(this.resourceGroups).forEach(([key, nodes]) => {
				newTokens.push(...resourceTreeToTokens(key === groupKey ? mergedGroupNodes : nodes));
			});

			this.$emit('update:resourceAccess', Array.from(new Set(newTokens)));
		},
		// Note: an admin can only see/edit path-root grants for instances they
		// themselves currently hold instance:: resource access to - inherited
		// from GET /instance/{id}/files enforcing that check on the caller, not
		// something introduced here.
		async ensureInstancesLoaded() {
			this.loadingInstances = true;
			if (!this.serverStore.instances.length) {
				await this.serverStore.fetchInstanceList();
			}
			await Promise.all(this.serverStore.instances.map(i => {
				if (!this.serverStore.instanceFileRoots[i.id] && this.$checkResourceAccess(`instance::${i.id}`)) {
					return this.serverStore.fetchInstanceFiles(i.id);
				}
			}));
			this.loadingInstances = false;
		}
	},
	mounted() {
		this.ensureInstancesLoaded();
	}
}
</script>

<style scoped>

</style>
