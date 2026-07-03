<template>
	<div>
		<p class="font-bold">GENERAL</p>
		<div class="flex items-center gap-2">
			<Checkbox class="h-4 w-4" :value="hasAccess" :disabled="disabled" @input="onAccessToggle" />
			<p>{{ PermissionsMeta.access.value }}</p>
			<Icon
				icon="circle-info"
				size="4"
				color="text-gray-6"
				:hoverText="PermissionsMeta.access.description"
			/>
		</div>

		<div class="flex flex-col sm:grid grid-cols-2 gap-2 mt-2">
			<div v-for="(nodes, groupName) in visiblePermGroups" :key="groupName" class="bg-[#252525] p-4 rounded">
				<p class="font-bold uppercase">{{ groupName }}</p>
				<CheckboxList
					class="mt-2"
					:nodes="nodes"
					@update:nodes="onGroupUpdate(groupName, $event)"
				>
					<template #default="{ payload }">
						<div class="flex items-center gap-2 cursor-default">
							<span 
								:class="['font-mono', { 'text-gray-7 line-through': payload.used === false} ]"
							>
								{{ showFull ? (payload.value || payload.label) : payload.label }}
							</span>
							<Icon
								v-if="payload.description"
								icon="circle-info"
								size="4"
								color="text-gray-6"
								:hoverText="payload.description"
							/>
						</div>
					</template>
				</CheckboxList>
			</div>
		</div>

		<div class="flex items-center gap-2 mt-4">
			<Checkbox class="h-4 w-4" :value="showUnused" @input="showUnused = $event" />
			<p>Show unused permissions</p>
		</div>
		<div class="flex items-center gap-2 mt-2">
			<Checkbox class="h-4 w-4" :value="showFull" @input="showFull = $event" />
			<p>Show full permission names</p>
		</div>
	</div>
</template>

<script>
import Checkbox from '@/components/common/Checkbox.vue';
import CheckboxList from '@/components/common/CheckboxList.vue';
import Icon from '@/components/common/Icon.vue';
import { PermissionsMeta, buildPermissionTree } from '@/util/permissionsMeta';
import { filterLeaves, mergeTreeUpdates, flattenLeaves } from '@/util/checkboxTree';


export default {
	mixins: [],
	components: {
		Checkbox,
		CheckboxList,
		Icon,
	},
	props: {
		// Currently granted permission strings for the user being edited.
		permissions: {
			type: Array,
			default: () => []
		},
		// When true, every checkbox is rendered read-only.
		disabled: {
			type: Boolean,
			default: false
		}
	},
	emits: ['update:permissions'],
	data() {
		return {
			PermissionsMeta,
			showUnused: false,
			showFull: false,
		}
	},
	computed: {
		permGroups() {
			return Object.fromEntries(
				Object.entries(PermissionsMeta)
					.filter(([groupName]) => groupName !== 'access')
					.map(([groupName, meta]) => [groupName, buildPermissionTree(meta, groupName, this.permissions, this.disabled)])
			);
		},
		visiblePermGroups() {
			if (this.showUnused) return this.permGroups;

			return Object.fromEntries(
				Object.entries(this.permGroups)
					.map(([groupName, nodes]) => [groupName, filterLeaves(nodes, node => !node.disabled)])
					.filter(([, nodes]) => nodes.length)
			);
		},
		hasAccess() {
			return this.permissions.includes(PermissionsMeta.access.value);
		}
	},
	methods: {
		onAccessToggle(value) {
			if (this.disabled) return;
			const accessValue = PermissionsMeta.access.value;
			const withoutAccess = this.permissions.filter(p => p !== accessValue);
			this.$emit('update:permissions', value ? [...withoutAccess, accessValue] : withoutAccess);
		},
		onGroupUpdate(groupName, updatedNodes) {
			if (this.disabled) return;

			const mergedGroupNodes = mergeTreeUpdates(this.permGroups[groupName], updatedNodes);

			const leaves = [];
			Object.entries(this.permGroups).forEach(([thisGroupName, nodes]) => {
				flattenLeaves(thisGroupName === groupName ? mergedGroupNodes : nodes, leaves);
			});

			const newPermissions = leaves.filter(leaf => leaf.value).map(leaf => leaf.id);
			if (this.hasAccess) newPermissions.push(PermissionsMeta.access.value);

			this.$emit('update:permissions', newPermissions);
		}
	},
}
</script>

<style scoped>

</style>
