<template>
	<div
		ref="editable"
		spellcheck="false"
		class="expandable-textarea"
		:class="{ 'is-disabled': disabled }"
		role="textbox"
		contenteditable="true"
		:aria-disabled="disabled"
		@beforeinput="onBeforeInput"
		@input="emitInput"
		@paste="onPaste"
	></div>
</template>

<script>

export default {
	mixins: [],
	components: {

	},
	props: {
		modelValue: {
			type: String,
			default: ""
		},
		disabled: {
			type: Boolean,
			default: false,
		}
	},
	data() {
		return {

		}
	},
	computed: {

	},
	watch: {
		modelValue(val) {
			// Only write to the DOM when the change came from outside this component.
			// Skipping when the values already match avoids resetting the caret while typing.
			// innerText (not textContent) so incoming newlines render as real line breaks.
			if (this.$refs.editable && val !== this.$refs.editable.innerText) {
				this.$refs.editable.innerText = val;
			}
		}
	},
	mounted() {
		this.$refs.editable.innerText = this.modelValue;
	},
	methods: {
		onBeforeInput(event) {
			// Keep the div contenteditable="true" in all states so its height stays
			// consistent, but block the actual mutation when disabled. beforeinput
			// covers typing, delete, cut, and drag-drop before the DOM changes.
			if (this.disabled) event.preventDefault();
		},
		emitInput(event) {
			if (this.disabled) return;

			// innerText preserves user-entered newlines as \n; textContent would drop them.
			this.$emit('update:modelValue', event.target.innerText);
		},
		onPaste(event) {
			if (this.disabled) return;

			// Strip formatting: pull plain text from the clipboard and insert it
			// ourselves so pasted rich content never enters the contenteditable DOM.
			event.preventDefault();
			const text = (event.clipboardData || window.clipboardData).getData('text/plain');
			document.execCommand('insertText', false, text);
		},
		focus() {
			setTimeout(() => {
				this.$refs.editable.focus();
			}, 0);
		}
	},
}
</script>

<style scoped>
.expandable-textarea {
	white-space: pre-wrap;
	/* Keep one line of height even when empty/disabled, so the field doesn't
	   collapse when contenteditable is removed (an empty non-editable div has
	   no intrinsic caret height). */
	min-height: 1lh;
}

.expandable-textarea.is-disabled {
	cursor: not-allowed;
	opacity: 0.6;
}
</style>
