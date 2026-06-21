<template>
	<Popup
		:open="open"
		:header-text="headerText"
		:buttons="popupButtons"
		@x-clicked="onCancel"
		body-class="w-11/12 sm:w-3/4 xl:w-1/2 h-3/4"
	>
		<div class="p-4">
			<PermissionEditor
				:permissions="draftPermissions"
				:disabled="disabled"
				@update:permissions="draftPermissions = $event"
			/>
		</div>
	</Popup>
</template>

<script>
import Popup from '@/components/common/Popup.vue';
import PermissionEditor from './PermissionEditor.vue';
import { BTN_VARIANT } from '@/util/constants';


export default {
	mixins: [],
	components: {
		Popup,
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
		disabled: {
			type: Boolean,
			default: false
		}
	},
	emits: ['cancel', 'apply'],
	data() {
		return {
			draftPermissions: []
		}
	},
	computed: {
		headerText() {
			if (!this.user) return '';
			return `EDIT PERMISSIONS (${this.user.displayName || this.user.username})`;
		},
		popupButtons() {
			const buttons = [{ text: 'CANCEL', variant: BTN_VARIANT.DANGER, onClick: this.onCancel }];
			if (!this.disabled) {
				buttons.push({ text: 'APPLY', variant: BTN_VARIANT.PRIMARY, onClick: this.onApply });
			}
			return buttons;
		}
	},
	methods: {
		resetDraft() {
			this.draftPermissions = Array.from(this.user?.permissions || []);
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
