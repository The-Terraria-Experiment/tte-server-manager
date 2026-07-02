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
				<p class="font-bold mb-1">ROLE NAME</p>
				<ValueInput placeholder="Role name" v-model="draftName" :disabled="disabled" maxlength="40" />
			</div>
			<PermissionEditor
				:permissions="draftPermissions"
				:disabled="disabled"
				@update:permissions="draftPermissions = $event"
			/>

			<p class="font-bold mt-4">RESOURCE ACCESS</p>
			<ResourcePermissionEditor
				class="mt-2"
				:resourceAccess="draftResourceAccess"
				:disabled="disabled"
				@update:resourceAccess="draftResourceAccess = $event"
			/>
		</div>
	</Popup>

	<Popup
		body-class="h-1/3 w-11/12 sm:w-1/2 lg:w-1/4"
		header-text="CONFIRM"
		layer="2"
		:open="confirmDeleteOpen"
		@x-clicked="confirmDeleteOpen = false"
		:buttons="[
			{ variant: BTN_VARIANT.PRIMARY, text: 'CANCEL', onClick: () => { confirmDeleteOpen = false } },
			{ variant: BTN_VARIANT.DANGER, text: 'DELETE', onClick: confirmDelete },
		]"
	>
		<div class="p-4 h-full w-full flex flex-col text-center justify-center items-center font-main font-bold">
			<p class="text-white-0 py-2">Are you sure you want to delete this role?</p>
			<div class="bg-gray-2 rounded px-2 font-mono break-all text-sm text-white-0">{{ role?.name }}</div>
		</div>
	</Popup>
</template>

<script>
import Popup from '@/components/common/Popup.vue';
import PermissionEditor from './PermissionEditor.vue';
import ResourcePermissionEditor from './ResourcePermissionEditor.vue';
import { BTN_VARIANT } from '@/util/constants';


export default {
	mixins: [],
	components: {
		Popup,
		PermissionEditor,
		ResourcePermissionEditor,
	},
	props: {
		open: {
			type: Boolean,
			default: false
		},
		// { roleId, name, permissions: string[], resourceAccess: string[] } | null - missing roleId means "new role"
		role: {
			type: [Object, null],
			default: null
		},
		disabled: {
			type: Boolean,
			default: false
		}
	},
	emits: ['cancel', 'apply', 'delete'],
	data() {
		return {
			BTN_VARIANT,
			draftName: "",
			draftPermissions: [],
			draftResourceAccess: [],
			confirmDeleteOpen: false,
		}
	},
	computed: {
		headerText() {
			if (this.role?.roleId) return `EDIT ROLE (${this.role.name})`;
			return 'NEW ROLE';
		},
		popupButtons() {
			const buttons = [{ text: 'CANCEL', variant: BTN_VARIANT.DANGER, onClick: this.onCancel }];
			if (!this.disabled && this.role?.roleId) {
				buttons.push({ text: 'DELETE', variant: BTN_VARIANT.DANGER, onClick: this.onDelete });
			}
			if (!this.disabled) {
				buttons.push({ text: 'APPLY', variant: BTN_VARIANT.PRIMARY, onClick: this.onApply });
			}
			return buttons;
		}
	},
	methods: {
		resetDraft() {
			this.draftName = this.role?.name || "";
			this.draftPermissions = Array.from(this.role?.permissions || []);
			this.draftResourceAccess = Array.from(this.role?.resourceAccess || []);
			this.confirmDeleteOpen = false;
		},
		onCancel() {
			this.$emit('cancel');
		},
		onApply() {
			if (!this.draftName.trim()) {
				this.$alert.error("Please enter a role name");
				return;
			}
			this.$emit('apply', { roleId: this.role?.roleId, name: this.draftName.trim(), permissions: this.draftPermissions, resourceAccess: this.draftResourceAccess });
		},
		onDelete() {
			this.confirmDeleteOpen = true;
		},
		confirmDelete() {
			this.confirmDeleteOpen = false;
			this.$emit('delete', { roleId: this.role.roleId });
		}
	},
	watch: {
		role() {
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
