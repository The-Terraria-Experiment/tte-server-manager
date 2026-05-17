<template>
	<Popup
		:open="open"
		:header-text="headerText"
		:body-class="bodyClass"
		:layer="layer"
		:buttons="popupButtons"
		@x-clicked="onCancel"
	>
		<div class="h-full flex flex-col bg-gray-4">
			<div class="px-4 py-2 border-b border-gray-2 flex items-center justify-between">
				<p class="text-xs font-main font-bold text-gray-7 tracking-wide">
					MODE: {{ displayLanguage }}
				</p>
				<p class="text-xs font-main text-gray-6">{{ lineCount }} lines</p>
			</div>

			<div class="editor-shell flex-1">
				<div ref="lineNumbers" class="editor-gutter">
					<div
						v-for="line in lineCount"
						:key="line"
						class="editor-line-number"
					>
						{{ line }}
					</div>
				</div>

				<div class="editor-surface">
					<pre ref="highlight" class="editor-pre" aria-hidden="true"><code class="editor-code" v-html="highlightedCode"></code></pre>
					<textarea
						ref="textarea"
						class="editor-textarea"
						spellcheck="false"
						:disabled="disabled"
						:value="pendingValue"
						@input.stop="onInput"
						@keydown="onKeydown"
						@scroll="syncScroll"
					></textarea>
				</div>
			</div>
		</div>
	</Popup>
</template>

<script>
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import { BTN_VARIANT } from '../../util/constants';
import Popup from './Popup.vue';

export default {
	components: {
		Popup,
	},
	emits: ['update:modelValue', 'cancel', 'save'],
	props: {
		modelValue: {
			type: String,
			default: '',
		},
		open: {
			type: Boolean,
			default: false,
		},
		language: {
			type: String,
			default: 'json',
		},
		headerText: {
			type: String,
			default: 'EDIT CODE',
		},
		bodyClass: {
			type: String,
			default: 'w-11/12 sm:w-10/12 lg:w-3/5 h-4/5',
		},
		layer: {
			type: String,
			default: '2',
		},
		disabled: {
			type: Boolean,
			default: false,
		},
	},
	data() {
		return {
			pendingValue: this.modelValue,
		};
	},
	computed: {
		popupButtons() {
			return [
				{ variant: BTN_VARIANT.DANGER, text: 'CANCEL', onClick: this.onCancel },
				{ variant: BTN_VARIANT.PRIMARY, text: 'SAVE', onClick: this.onSave },
			];
		},
		lineCount() {
			if (!this.pendingValue) return 1;
			return this.pendingValue.split('\n').length || 1;
		},
		displayLanguage() {
			return (this.language || 'text').toUpperCase();
		},
		highlightedCode() {
			const code = this.pendingValue || '';
			const prismLang = this.getPrismLanguage();
			if (!prismLang) return this.escapeHtml(code);
			return Prism.highlight(code, prismLang, this.language);
		},
	},
	watch: {
		open(isOpen) {
			if (isOpen) {
				this.pendingValue = this.modelValue || '';
				this.$nextTick(() => this.resetScroll());
			}
		},
	},
	methods: {
		getPrismLanguage() {
			const requested = (this.language || '').toLowerCase();
			if (requested && Prism.languages[requested]) return Prism.languages[requested];
			if (requested === 'yml' && Prism.languages.yaml) return Prism.languages.yaml;
			if (requested === 'yaml' && Prism.languages.yaml) return Prism.languages.yaml;
			if (requested === 'json' && Prism.languages.json) return Prism.languages.json;
			return null;
		},
		escapeHtml(value) {
			return value
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		},
		onInput(event) {
			this.pendingValue = event.target.value;
		},
		onKeydown(event) {
			if (event.key !== 'Tab') return;
			event.preventDefault();
			const textarea = event.target;
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const value = this.pendingValue || '';

			if (event.shiftKey) {
				const lineStart = value.lastIndexOf('\n', start - 1) + 1;
				let lineEnd = value.indexOf('\n', end);
				if (lineEnd === -1) lineEnd = value.length;
				const block = value.slice(lineStart, lineEnd);
				const lines = block.split('\n');
				let removedBeforeStart = 0;
				let removedTotal = 0;
				const newLines = lines.map((line, index) => {
					if (line.startsWith('\t')) {
						const removed = 1;
						if (index === 0) removedBeforeStart += removed;
						removedTotal += removed;
						return line.slice(1);
					}
					return line;
				});
				const nextValue = `${value.slice(0, lineStart)}${newLines.join('\n')}${value.slice(lineEnd)}`;
				this.pendingValue = nextValue;
				this.$nextTick(() => {
					textarea.selectionStart = Math.max(start - removedBeforeStart, lineStart);
					textarea.selectionEnd = Math.max(end - removedTotal, lineStart);
				});
				return;
			}

			const nextValue = `${value.slice(0, start)}\t${value.slice(end)}`;
			this.pendingValue = nextValue;
			this.$nextTick(() => {
				textarea.selectionStart = start + 1;
				textarea.selectionEnd = start + 1;
			});
		},
		onSave() {
			this.$emit('update:modelValue', this.pendingValue);
			this.$emit('save');
		},
		onCancel() {
			this.$emit('cancel');
		},
		syncScroll() {
			const textarea = this.$refs.textarea;
			const highlight = this.$refs.highlight;
			const lineNumbers = this.$refs.lineNumbers;
			if (!textarea) return;
			const top = textarea.scrollTop;
			const left = textarea.scrollLeft;
			if (highlight) {
				highlight.scrollTop = top;
				highlight.scrollLeft = left;
			}
			if (lineNumbers) {
				lineNumbers.scrollTop = top;
			}
		},
		resetScroll() {
			const textarea = this.$refs.textarea;
			const highlight = this.$refs.highlight;
			const lineNumbers = this.$refs.lineNumbers;
			if (textarea) {
				textarea.scrollTop = 0;
				textarea.scrollLeft = 0;
			}
			if (highlight) {
				highlight.scrollTop = 0;
				highlight.scrollLeft = 0;
			}
			if (lineNumbers) {
				lineNumbers.scrollTop = 0;
			}
		},
	},
};
</script>

<style scoped>
.editor-shell {
	display: grid;
	grid-template-columns: 52px 1fr;
	min-height: 0;
	background-color: #1b1f26;
}

.editor-gutter {
	background-color: #14181f;
	color: #7b8794;
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	font-size: 12px;
	line-height: 1.6;
	padding: 12px 8px;
	text-align: right;
	overflow: hidden;
}

.editor-line-number {
	height: 1.6em;
}

.editor-surface {
	position: relative;
	min-height: 0;
	overflow: hidden;
}

.editor-pre {
	position: absolute;
	inset: 0;
	margin: 0;
	padding: 12px 16px;
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
	font-size: 12px;
	line-height: 1.6;
	color: #d7dde6;
	background-color: transparent;
	white-space: pre;
	overflow: auto;
	min-height: 100%;
	text-indent: 0;
}

.editor-code {
	display: block;
	padding: 0;
	margin: 0;
	white-space: pre;
	text-indent: 0;
}

.editor-textarea {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	padding: 12px 16px;
	border: none;
	background: transparent;
	color: transparent;
	caret-color: #f5f7fb;
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
	font-size: 12px;
	line-height: 1.6;
	outline: none;
	resize: none;
	white-space: pre;
	overflow: auto;
	text-indent: 0;
}

.editor-textarea:focus {
	box-shadow: none;
}

:deep(.token.comment),
:deep(.token.prolog),
:deep(.token.doctype),
:deep(.token.cdata) {
	color: #7b8794;
}

:deep(.token.property),
:deep(.token.tag),
:deep(.token.constant),
:deep(.token.symbol),
:deep(.token.deleted) {
	color: #ff8c8c;
}

:deep(.token.boolean),
:deep(.token.number) {
	color: #f6c177;
}

:deep(.token.string),
:deep(.token.char),
:deep(.token.builtin),
:deep(.token.inserted) {
	color: #9ad17b;
}

:deep(.token.selector),
:deep(.token.attr-name),
:deep(.token.function),
:deep(.token.class-name) {
	color: #6fc3ff;
}

:deep(.token.keyword),
:deep(.token.atrule) {
	color: #a48cff;
}
</style>
