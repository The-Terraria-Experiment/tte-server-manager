<template>
	<Popup
		:open="open"
		:header-text="headerText"
		:buttons="popupButtons"
		@x-clicked="onCancel"
		body-class="w-11/12 sm:w-3/4 xl:w-1/2 h-3/4"
	>
		<div class="p-4">
			<div class="mb-4">
				<p class="font-bold mb-1">ROLES</p>
				<div v-if="roles.length" class="flex flex-wrap gap-2">
					<div
						v-for="role in roles"
						:key="role.roleId"
						:class="[
							'rounded-full px-3 py-1.5 font-mono font-bold text-sm select-none',
							hasRole(role) ? 'bg-teal-2 text-cream' : 'bg-gray-4 text-gray-8',
							disabled ? 'cursor-default' : 'cursor-pointer hover:opacity-80'
						]"
						@click="toggleRole(role)"
					>
						{{ role.name }}
					</div>
				</div>
				<p v-else class="text-gray-7 italic">No roles defined yet</p>
			</div>

			<div class="mb-4" v-if="miscPermissions.length">
				<p class="font-bold mb-1">OTHER PERMISSIONS</p>
				<div class="flex flex-wrap gap-2">
					<div
						v-for="perm in miscPermissions"
						:key="perm"
						class="rounded-full px-3 py-1.5 font-mono text-sm bg-gray-5 text-gray-9 select-none"
					>
						{{ perm }}
					</div>
				</div>
			</div>

			<div class="bg-gray-2 rounded-lg">
				<div
					class="flex items-center mt-2 cursor-pointer justify-between w-full p-2"
					@click="showAdvanced = !showAdvanced"
				>
					<p class="ml-2 font-main font-bold text-sm text-teal-4">EDIT DIRECTLY</p>
					<Icon
						icon="caret-down"
						size="6"
						color="text-teal-4"
						:class="['transition-transform duration-200', { 'rotate-180': showAdvanced }]"
					/>
				
				</div>

				<PermissionEditor
					v-if="showAdvanced"
					class="mt-4 mx-4 pb-4"
					:permissions="draftPermissions"
					:disabled="disabled"
					@update:permissions="draftPermissions = $event"
				/>
			</div>
		</div>
	</Popup>
</template>

<script>
import Popup from '@/components/common/Popup.vue';
import Icon from '@/components/common/Icon.vue';
import PermissionEditor from './PermissionEditor.vue';
import { BTN_VARIANT } from '@/util/constants';
import { getMatchedRoles, getUncoveredPermissions, addRolePermissions, removeRolePermissions } from '@/util/rolePermissions';


export default {
	mixins: [],
	components: {
		Popup,
		Icon,
		PermissionEditor,
	},
	props: {
		open: {
			type: Boolean,
			default: false
		},
		// { userID, displayName, username, permissions: Set<string> }
		user: {
			type: [Object, null],
			default: null
		},
		// [{ roleId, name, permissions: string[] }]
		roles: {
			type: Array,
			default: () => []
		},
		disabled: {
			type: Boolean,
			default: false
		}
	},
	emits: ['cancel', 'apply'],
	data() {
		return {
			BTN_VARIANT,
			draftPermissions: [],
			showAdvanced: false,
		}
	},
	computed: {
		headerText() {
			if (!this.user) return '';
			return `EDIT ROLES (${this.user.displayName || this.user.username})`;
		},
		popupButtons() {
			const buttons = [{ text: 'CANCEL', variant: BTN_VARIANT.DANGER, onClick: this.onCancel }];
			if (!this.disabled) {
				buttons.push({ text: 'APPLY', variant: BTN_VARIANT.PRIMARY, onClick: this.onApply });
			}
			return buttons;
		},
		matchedRoles() {
			return getMatchedRoles(this.draftPermissions, this.roles);
		},
		miscPermissions() {
			return getUncoveredPermissions(this.draftPermissions, this.roles);
		}
	},
	methods: {
		resetDraft() {
			this.draftPermissions = Array.from(this.user?.permissions || []);
			this.showAdvanced = false;
		},
		hasRole(role) {
			return this.matchedRoles.some(r => r.roleId === role.roleId);
		},
		toggleRole(role) {
			if (this.disabled) return;

			this.draftPermissions = this.hasRole(role)
				? removeRolePermissions(this.draftPermissions, role, this.roles)
				: addRolePermissions(this.draftPermissions, role);
		},
		onCancel() {
			this.$emit('cancel');
		},
		onApply() {
			this.$emit('apply', { userID: this.user.userID, permissions: this.draftPermissions });
		}
	},
	watch: {
		user() {
			this.resetDraft();
		},
		open(isOpen) {
			if (isOpen) this.resetDraft();
		}
	},
	mounted() {
		this.resetDraft();
	}
}
</script>

<style scoped>

</style>
