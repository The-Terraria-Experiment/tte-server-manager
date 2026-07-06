<template>
	<Popup
		:open="open"
		:header-text="headerText"
		:buttons="popupButtons"
		:x-disabled="anyLoading"
		:close-when-bg-clicked="!anyLoading"
		@x-clicked="onCancel"
		body-class="w-11/12 sm:w-3/4 xl:w-1/2 h-1/2"
	>
		<div class="p-4">
			<div class="mb-4">
				<p class="font-bold mb-1">PATREON TIER ID</p>
				<ValueInput placeholder="Patreon tier ID" v-model="draftTierId" :disabled="disabled || isEditing" maxlength="40" />
			</div>
			<div class="mb-4">
				<p class="font-bold mb-1">TIER NAME (for reference only)</p>
				<ValueInput placeholder="e.g. Gold Tier" v-model="draftTierName" :disabled="disabled" maxlength="60" />
			</div>
			<div class="mb-4">
				<p class="font-bold mb-1">GRANTS ROLE</p>
				<Dropdown
					v-model="draftRoleId"
					:options="roleOptions"
					placeholder="Select a role"
					:disabled="disabled"
				/>
			</div>
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
			<p class="text-white-0 py-2">Are you sure you want to remove this tier mapping?</p>
			<div class="bg-gray-2 rounded px-2 font-mono break-all text-sm text-white-0">{{ entry?.tierId }}</div>
			<p class="text-white-0 py-2">This will not remove permissions already granted to existing users.</p>
		</div>
	</Popup>
</template>

<script>
import Popup from '@/components/common/Popup.vue';
import ValueInput from '@/components/common/ValueInput.vue';
import Dropdown from '@/components/common/Dropdown.vue';
import { useRolesStore } from '@/stores/rolesStore';
import { BTN_VARIANT } from '@/util/constants';


export default {
	mixins: [],
	components: {
		Popup,
		ValueInput,
		Dropdown,
	},
	props: {
		open: {
			type: Boolean,
			default: false
		},
		// { tierId, tierName, roleId } | null - missing tierId means "new mapping"
		entry: {
			type: [Object, null],
			default: null
		},
		disabled: {
			type: Boolean,
			default: false
		},
		// { save: boolean, delete: boolean }
		loading: {
			type: Object,
			default: () => ({ save: false, delete: false })
		}
	},
	emits: ['cancel', 'apply', 'delete'],
	data() {
		return {
			BTN_VARIANT,
			rolesStore: useRolesStore(),
			draftTierId: "",
			draftTierName: "",
			draftRoleId: "",
			confirmDeleteOpen: false,
		}
	},
	computed: {
		isEditing() {
			return Boolean(this.entry?.tierId);
		},
		headerText() {
			if (this.isEditing) return `EDIT TIER MAPPING (${this.entry.tierId})`;
			return 'NEW TIER MAPPING';
		},
		roleOptions() {
			return this.rolesStore.roles.map((role) => ({ id: role.roleId, text: role.name }));
		},
		anyLoading() {
			return this.loading.save || this.loading.delete;
		},
		popupButtons() {
			const buttons = [{ text: 'CANCEL', variant: BTN_VARIANT.DANGER, onClick: this.onCancel, disabled: this.anyLoading }];
			if (!this.disabled && this.isEditing) {
				buttons.push({ text: 'DELETE', variant: BTN_VARIANT.DANGER, onClick: this.onDelete, loading: this.loading.delete, disabled: this.anyLoading });
			}
			if (!this.disabled) {
				buttons.push({ text: 'SAVE', variant: BTN_VARIANT.PRIMARY, onClick: this.onApply, loading: this.loading.save, disabled: this.anyLoading });
			}
			return buttons;
		}
	},
	methods: {
		resetDraft() {
			this.draftTierId = this.entry?.tierId || "";
			this.draftTierName = this.entry?.tierName || "";
			this.draftRoleId = this.entry?.roleId || "";
			this.confirmDeleteOpen = false;
		},
		onCancel() {
			this.$emit('cancel');
		},
		onApply() {
			if (!this.draftTierId.trim()) {
				this.$alert.error("Please enter a Patreon tier ID");
				return;
			}
			if (!this.draftRoleId) {
				this.$alert.error("Please select a role");
				return;
			}
			this.$emit('apply', { tierId: this.draftTierId.trim(), tierName: this.draftTierName.trim(), roleId: this.draftRoleId });
		},
		onDelete() {
			this.confirmDeleteOpen = true;
		},
		confirmDelete() {
			this.confirmDeleteOpen = false;
			this.$emit('delete', { tierId: this.entry.tierId });
		}
	},
	watch: {
		entry() {
			this.resetDraft();
		},
		open(isOpen) {
			if (isOpen) this.resetDraft();
		}
	},
	mounted() {
		this.resetDraft();
		this.rolesStore.fetchRoles();
	}
}
</script>

<style scoped>

</style>
