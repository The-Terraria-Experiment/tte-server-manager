<template>
	<Popup
		:open="open"
		:header-text="headerText"
		:buttons="popupButtons"
		:x-disabled="anyLoading"
		:close-when-bg-clicked="!anyLoading"
		@x-clicked="onCancel"
		body-class="w-11/12 sm:w-1/2 xl:w-1/3 h-1/2"
	>
		<div class="p-4">
			<div class="mb-4">
				<p class="font-bold mb-1">EC2 Instance ID</p>
				<ValueInput
					placeholder="i-0123456789abcdef0"
					v-model="draftInstanceId"
					:disabled="disabled || isEditing"
					maxlength="21"
				/>
				<p class="mt-1 text-sm text-gray-7" v-if="!isEditing">
					The instance must already exist in EC2 — it is checked before being registered.
				</p>
			</div>
			<div class="mb-4">
				<p class="font-bold mb-1">Environments</p>
				<!-- <p class="mb-2 text-sm text-gray-7">
					Which sites list this instance. An instance with no environments keeps its saved
					configuration but is hidden everywhere.
				</p> -->
				<label
					v-for="env in environments"
					:key="env"
					class="flex items-center mb-2"
					:class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
				>
					<Checkbox
						:model-value="draftEnvs.includes(env)"
						:disabled="disabled"
						@update:modelValue="(checked) => toggleEnv(env, checked)"
					/>
					<span class="ml-2 font-mono text-sm text-white-0 uppercase">{{ env }}</span>
				</label>
			</div>
			<div v-if="entry?.missing" class="rounded bg-gray-4 border border-red-4 p-2">
				<p class="text-sm text-red-3">
					EC2 has no instance with this ID. It was probably terminated.
				</p>
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
			{ variant: BTN_VARIANT.DANGER, text: 'REMOVE', onClick: confirmDelete, loading: loading.delete },
		]"
	>
		<div class="p-4 h-full w-full flex flex-col text-center justify-center items-center font-main font-bold">
			<p class="text-white-0 py-2">Remove this instance from the registry?</p>
			<div class="bg-gray-2 rounded px-2 font-mono break-all text-sm text-white-0">{{ entry?.name }} ({{ entry?.id }})</div>
			<p class="text-white-0 py-2 text-sm font-normal">
				Its saved file paths and metrics settings are deleted too. The instance itself is not affected.
			</p>
		</div>
	</Popup>
</template>

<script>
import Popup from '@/components/common/Popup.vue';
import ValueInput from '@/components/common/ValueInput.vue';
import Checkbox from '@/components/common/Checkbox.vue';
import { BTN_VARIANT } from '@/util/constants';

const INSTANCE_ID_PATTERN = /^i-[0-9a-f]{8}(?:[0-9a-f]{9})?$/;

export default {
	mixins: [],
	components: {
		Popup,
		ValueInput,
		Checkbox,
	},
	props: {
		open: {
			type: Boolean,
			default: false
		},
		// { id, envs, name, state, missing } | null - missing id means "new registration"
		entry: {
			type: [Object, null],
			default: null
		},
		environments: {
			type: Array,
			default: () => []
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
			draftInstanceId: "",
			draftEnvs: [],
			confirmDeleteOpen: false,
		}
	},
	computed: {
		isEditing() {
			return Boolean(this.entry?.id);
		},
		headerText() {
			if (this.isEditing) return `EDIT INSTANCE (${this.entry.name})`;
			return 'REGISTER INSTANCE';
		},
		anyLoading() {
			return this.loading.save || this.loading.delete;
		},
		popupButtons() {
			const buttons = [{ text: 'CANCEL', variant: BTN_VARIANT.DANGER, onClick: this.onCancel, disabled: this.anyLoading }];
			if (!this.disabled && this.isEditing) {
				buttons.push({ text: 'REMOVE', variant: BTN_VARIANT.DANGER, onClick: this.onDelete, loading: this.loading.delete, disabled: this.anyLoading });
			}
			if (!this.disabled) {
				buttons.push({ text: 'SAVE', variant: BTN_VARIANT.PRIMARY, onClick: this.onApply, loading: this.loading.save, disabled: this.anyLoading });
			}
			return buttons;
		}
	},
	methods: {
		resetDraft() {
			this.draftInstanceId = this.entry?.id || "";
			this.draftEnvs = [...(this.entry?.envs || [])];
			this.confirmDeleteOpen = false;
		},
		toggleEnv(env, checked) {
			if (this.disabled) return;
			if (checked) {
				if (!this.draftEnvs.includes(env)) this.draftEnvs.push(env);
			} else {
				this.draftEnvs = this.draftEnvs.filter((value) => value !== env);
			}
		},
		onCancel() {
			this.$emit('cancel');
		},
		onApply() {
			const instanceId = this.draftInstanceId.trim().toLowerCase();
			if (!INSTANCE_ID_PATTERN.test(instanceId)) {
				this.$alert.error("Enter a valid EC2 instance ID, e.g. i-0123456789abcdef0");
				return;
			}
			// Only enforced when registering: an existing instance has to be able to drop to zero
			// environments, which is how it gets hidden without losing its saved configuration.
			if (!this.isEditing && this.draftEnvs.length === 0) {
				this.$alert.error("Select at least one environment");
				return;
			}
			this.$emit('apply', { instanceId, envs: [...this.draftEnvs], isNew: !this.isEditing });
		},
		onDelete() {
			this.confirmDeleteOpen = true;
		},
		confirmDelete() {
			this.confirmDeleteOpen = false;
			this.$emit('delete', { instanceId: this.entry.id });
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
	}
}
</script>

<style scoped>

</style>
