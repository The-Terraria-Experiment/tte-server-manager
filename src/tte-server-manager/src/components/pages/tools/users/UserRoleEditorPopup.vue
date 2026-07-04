<template>
	<Popup
		:open="open"
		:header-text="headerText"
		:buttons="popupButtons"
		:x-disabled="anyLoading"
		:close-when-bg-clicked="!anyLoading"
		@x-clicked="onCancel"
		body-class="w-11/12 sm:w-3/4 xl:w-1/2 h-3/4"
	>
		<div class="p-4">
			<div class="mb-4">
				<p class="font-bold mb-1">ROLES</p>
				<template v-if="roles.length">
					<div v-if="assignedRoles.length" class="flex flex-wrap gap-2 mb-4">
						<div
							v-for="role in assignedRoles"
							:key="role.roleId"
							:class="[
								'rounded-full pl-3 pr-2 py-1.5 font-mono font-bold text-sm select-none flex items-center gap-1.5',
								role.color ? roleChipTextClass(role) : 'bg-teal-2 text-cream'
							]"
							:style="roleChipStyle(role)"
						>
							{{ role.name }}
							<Icon
								v-if="!disabled"
								icon="xmark"
								size="4"
								:color="roleChipTextClass(role)"
								class="cursor-pointer"
								hover-text="Remove role"
								@click="toggleRole(role)"
							/>
						</div>
					</div>
					<p v-else class="text-gray-7 italic mb-4">No roles assigned</p>

					<div v-if="availableRoles.length" class="flex flex-wrap items-center gap-2">
						<p class="text-gray-7 text-sm mr-1">Available:</p>
						<div
							v-for="role in availableRoles"
							:key="role.roleId"
							:class="[
								'rounded-full pl-2 pr-3 py-1.5 font-mono font-bold text-sm select-none bg-gray-4 text-gray-8 flex items-center gap-1.5',
								disabled ? 'cursor-default' : 'cursor-pointer hover:opacity-80'
							]"
							@click="toggleRole(role)"
						>
							<span v-if="role.color" class="h-2.5 w-2.5 rounded-full shrink-0" :style="{ backgroundColor: role.color }"></span>
							<Icon icon="plus" size="4" color="text-gray-8" />
							{{ role.name }}
						</div>
					</div>
				</template>
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

			<div class="mb-4" v-if="miscResourceAccess.length">
				<p class="font-bold mb-1">OTHER RESOURCE ACCESS</p>
				<div class="flex flex-wrap gap-2">
					<div
						v-for="resource in miscResourceAccess"
						:key="resource"
						class="rounded-full px-3 py-1.5 font-mono text-sm bg-gray-5 text-gray-9 select-none"
					>
						{{ resource }}
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

				<template v-if="showAdvanced">
					<PermissionEditor
						class="mt-4 mx-4"
						:permissions="draftPermissions"
						:disabled="disabled"
						@update:permissions="draftPermissions = $event"
					/>
					<p class="font-bold mt-4 mx-4">RESOURCE ACCESS</p>
					<ResourcePermissionEditor
						class="mt-2 mx-4 pb-4"
						:resourceAccess="draftResourceAccess"
						:disabled="disabled"
						@update:resourceAccess="draftResourceAccess = $event"
					/>
				</template>
			</div>

			<p class="text-gray-7 text-sm mt-8">Last online: {{ lastOnlineText }}</p>
			<FlexButton
				v-if="canDelete"
				class="mt-2"
				:variant="BTN_VARIANT.DANGER"
				leftIcon="trash-can"
				:loading="loading.delete"
				:disabled="anyLoading"
				@input="onDelete"
			>
				<p class="py-2 px-8">DELETE USER</p>
			</FlexButton>
		</div>
	</Popup>

	<Popup
		body-class="h-1/3 w-11/12 sm:w-1/2 lg:w-1/4"
		header-text="CONFIRM"
		layer="2"
		:open="confirmDeleteOpen"
		:x-disabled="loading.delete"
		:close-when-bg-clicked="!loading.delete"
		@x-clicked="confirmDeleteOpen = false"
		:buttons="[
			{ variant: BTN_VARIANT.PRIMARY, text: 'CANCEL', onClick: () => { confirmDeleteOpen = false }, disabled: loading.delete },
			{ variant: BTN_VARIANT.DANGER, text: 'DELETE', onClick: confirmDelete, loading: loading.delete },
		]"
	>
		<div class="p-4 h-full w-full flex flex-col text-center justify-center items-center font-main font-bold">
			<p class="text-white-0 py-2">Are you sure you want to delete this user?</p>
			<div class="bg-gray-2 rounded px-2 font-mono break-all text-sm text-white-0">{{ user?.displayName || user?.username }}</div>
			<p class="text-white-0 py-2">This will permanently remove their Cognito account, email, and permissions. This cannot be undone.</p>
		</div>
	</Popup>
</template>

<script>
import Popup from '@/components/common/Popup.vue';
import Icon from '@/components/common/Icon.vue';
import FlexButton from '@/components/common/FlexButton.vue';
import PermissionEditor from './PermissionEditor.vue';
import ResourcePermissionEditor from './ResourcePermissionEditor.vue';
import { BTN_VARIANT } from '@/util/constants';
import { getMatchedRoles, getUncoveredPermissions, getUncoveredResourceAccess, addRoleGrants, removeRoleGrants } from '@/util/rolePermissions';
import { getContrastTextClass } from '@/util/color';


export default {
	mixins: [],
	components: {
		Popup,
		Icon,
		FlexButton,
		PermissionEditor,
		ResourcePermissionEditor,
	},
	props: {
		open: {
			type: Boolean,
			default: false
		},
		// { userID, displayName, username, permissions: Set<string>, resourceAccess: Set<string> }
		user: {
			type: [Object, null],
			default: null
		},
		// [{ roleId, name, permissions: string[], resourceAccess: string[] }]
		roles: {
			type: Array,
			default: () => []
		},
		disabled: {
			type: Boolean,
			default: false
		},
		canDelete: {
			type: Boolean,
			default: false
		},
		// { save: boolean, delete: boolean }
		loading: {
			type: Object,
			default: () => ({ save: false, delete: false })
		}
	},
	emits: ['cancel', 'save', 'delete'],
	data() {
		return {
			BTN_VARIANT,
			draftPermissions: [],
			draftResourceAccess: [],
			showAdvanced: false,
			confirmDeleteOpen: false,
		}
	},
	computed: {
		headerText() {
			if (!this.user) return '';
			return `EDIT ROLES (${this.user.displayName || this.user.username})`;
		},
		anyLoading() {
			return this.loading.save || this.loading.delete;
		},
		popupButtons() {
			const buttons = [{ text: 'CANCEL', variant: BTN_VARIANT.DANGER, onClick: this.onCancel, disabled: this.anyLoading }];
			if (!this.disabled) {
				buttons.push({ text: 'SAVE', variant: BTN_VARIANT.PRIMARY, onClick: this.onSave, loading: this.loading.save, disabled: this.anyLoading });
			}
			return buttons;
		},
		lastOnlineText() {
			if (!this.user?.lastLogin) return 'Never';
			return new Date(this.user.lastLogin).toLocaleString();
		},
		matchedRoles() {
			return getMatchedRoles(this.draftPermissions, this.draftResourceAccess, this.roles);
		},
		assignedRoles() {
			return this.roles.filter(role => this.hasRole(role));
		},
		availableRoles() {
			return this.roles.filter(role => !this.hasRole(role));
		},
		miscPermissions() {
			return getUncoveredPermissions(this.draftPermissions, this.draftResourceAccess, this.roles);
		},
		miscResourceAccess() {
			return getUncoveredResourceAccess(this.draftPermissions, this.draftResourceAccess, this.roles);
		}
	},
	methods: {
		resetDraft() {
			this.draftPermissions = Array.from(this.user?.permissions || []);
			this.draftResourceAccess = Array.from(this.user?.resourceAccess || []);
			this.showAdvanced = false;
			this.confirmDeleteOpen = false;
		},
		hasRole(role) {
			return this.matchedRoles.some(r => r.roleId === role.roleId);
		},
		roleChipStyle(role) {
			return role.color ? { backgroundColor: role.color } : {};
		},
		roleChipTextClass(role) {
			return role.color ? getContrastTextClass(role.color) : 'text-cream';
		},
		toggleRole(role) {
			if (this.disabled) return;

			const result = this.hasRole(role)
				? removeRoleGrants(this.draftPermissions, this.draftResourceAccess, role, this.roles)
				: addRoleGrants(this.draftPermissions, this.draftResourceAccess, role);
			this.draftPermissions = result.permissions;
			this.draftResourceAccess = result.resourceAccess;
		},
		onCancel() {
			this.$emit('cancel');
		},
		onSave() {
			this.$emit('save', { userID: this.user.userID, permissions: this.draftPermissions, resourceAccess: this.draftResourceAccess });
		},
		onDelete() {
			this.confirmDeleteOpen = true;
		},
		confirmDelete() {
			this.confirmDeleteOpen = false;
			this.$emit('delete', { userID: this.user.userID });
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
