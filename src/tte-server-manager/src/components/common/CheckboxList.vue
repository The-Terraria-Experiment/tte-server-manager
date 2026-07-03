<template>
	<ul class="space-y-1">
		<li v-for="node in nodes" :key="node.id">
			<div class="flex items-center gap-2">
				<Checkbox
					class="h-4 w-4 shrink-0"
					:value="getNodeValue(node)"
					:disabled="node.disabled"
					@input="onToggle(node, $event)"
				/>
				<slot
					:node="node"
					:value="getNodeValue(node)"
					:disabled="!!node.disabled"
					:payload="node.payload"
				>{{ node.id }}</slot>
			</div>

			<CheckboxList
				v-if="node.children"
				class="ml-6 mt-1"
				:nodes="node.children"
				:__root="false"
				@update:nodes="onChildUpdate(node, $event)"
			>
				<template #default="slotProps">
					<slot v-bind="slotProps"></slot>
				</template>
			</CheckboxList>
		</li>
	</ul>
</template>

<script>
import Checkbox from './Checkbox.vue';
import { getNodeValue, setNodeValue, flattenLeaves } from '../../util/checkboxTree';

export default {
	name: "CheckboxList",
	components: {
		Checkbox,
	},
	props: {
		nodes: {
			type: Array,
			required: true
		},
		__root: {
			type: Boolean,
			default: true
		}
	},
	emits: ['update:nodes', 'change'],
	methods: {
		getNodeValue,
		emitUpdate(updatedNodes) {
			this.$emit('update:nodes', updatedNodes);
			if (this.__root) {
				this.$emit('change', flattenLeaves(updatedNodes));
			}
		},
		onToggle(node, newValue) {
			const updatedNode = setNodeValue(node, newValue);
			this.emitUpdate(this.nodes.map(n => n === node ? updatedNode : n));
		},
		onChildUpdate(node, updatedChildren) {
			const updatedNode = { ...node, children: updatedChildren };
			this.emitUpdate(this.nodes.map(n => n === node ? updatedNode : n));
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";
</style>
