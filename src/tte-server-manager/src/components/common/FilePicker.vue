<template>
	<div class="">
		<label class="text-cream font-main font-bold text-center bg-linear-to-r from-teal-4 to-teal-1 py-2 px-4 w-full cursor-pointer rounded-lg flex items-center gradientbg select-none">
			<div class="flex items-center justify-center w-full gap-2">
				<Icon icon="upload" color="text-white-1" size="5" />
				<p class="">{{ pickLabel }}</p>
			</div>
			<input
				ref="fileInput"
				type="file"
				class="w-full text-white-0 bg-gray-2 rounded px-3 py-2 cursor-pointer hidden"
				:accept="accept"
				:webkitdirectory="isFolder"
				@change="onChange"
				:multiple="isFolder || multiple"
			/>
		</label>

		<div v-if="internalFiles && internalFiles.length > 0" class="mt-4 bg-gray-5 rounded-lg p-3">
			<p class="font-main font-bold text-sm text-teal-4">{{ pickedLabel }}</p>
			<div class="mt-2 font-mono text-white-0 text-sm max-h-48 overflow-y-auto">
				<p><strong>{{ internalFiles.length }}</strong> file(s)</p>
				<p class="mt-1 text-xs text-gray-8">Total: {{ formatBytes(totalSize) }}</p>
				<div class="mt-2 text-xs">
					<p v-for="(file, i) in internalFiles.slice(0, 5)" :key="i" class="truncate">• {{ file.webkitRelativePath || file.name }}</p>
					<p v-if="internalFiles.length > 5" class="text-gray-8">... and {{ internalFiles.length - 5 }} more</p>
				</div>
			</div>
			<FlexButton class="mt-3" :variant="BTN_VARIANT.DANGER" @input="clearFiles">
				<p class="py-2 px-6">Cancel</p>
			</FlexButton>
		</div>
	</div>
</template>

<script>
import FlexButton from "./FlexButton.vue";
import {BTN_VARIANT} from "../../util/constants";
import Icon from "./Icon.vue";

export default {
	components: {
		FlexButton,
		Icon,
	},
	props: {
		modelValue: {
			type: [File, Array],
			default: null,
		},
		accept: {
			type: String,
			default: "*"
		},
		isFolder: {
			type: Boolean,
			default: false
		},
		/**
		 * Whether more than one file can be picked at once. Ignored for folder mode, which always needs
		 * the native `multiple` attribute set for a full recursive selection regardless of this prop.
		 * Default `true` preserves every existing caller's behavior; a caller picking exactly one thing
		 * that means something on its own (e.g. one export file to view) should pass `false` so the
		 * control itself doesn't suggest a multi-file selection is meaningful here.
		 */
		multiple: {
			type: Boolean,
			default: true
		},
		customLabel: {
			type: String,
			default: null
		}
	},
	emits: ["update:modelValue", "cleared"],
	data() {
		return {
			BTN_VARIANT,
			internalFiles: Array.isArray(this.modelValue) ? this.modelValue : (this.modelValue ? [this.modelValue] : []),
		};
	},
	computed: {
		totalSize() {
			return this.internalFiles.reduce((sum, file) => sum + file.size, 0);
		},
		singleFileMode() {
			return !this.isFolder && !this.multiple;
		},
		pickLabel() {
			if (this.customLabel) return this.customLabel;
			if (this.isFolder) return "CHOOSE FOLDER";
			return this.singleFileMode ? "CHOOSE FILE" : "CHOOSE FILE(S)";
		},
		pickedLabel() {
			if (this.isFolder) return "PICKED FOLDER";
			return this.singleFileMode ? "PICKED FILE" : "PICKED FILES";
		},
	},
	watch: {
		modelValue(val) {
			this.internalFiles = Array.isArray(val) ? val : (val ? [val] : []);
		},
	},
	methods: {
		onChange(e) {
			let files = e.target.files ? Array.from(e.target.files) : [];
			// Without the native `multiple` attribute the OS picker already restricts selection to one,
			// but this guards the same invariant against anything that hands the input a longer list.
			if (this.singleFileMode) {
				files = files.slice(0, 1);
			}
			this.internalFiles = files;

			// Folder mode always emits the list; single-file mode never emits an array, so a caller that
			// only ever expects one `File` (or null) doesn't have to branch on the shape; multi-file mode
			// keeps the existing single-file/array split for backward compatibility.
			const value = this.isFolder
				? files
				: this.singleFileMode
					? (files[0] ?? null)
					: (files.length === 1 ? files[0] : files);
			this.$emit("update:modelValue", value);
		},
		clearFiles() {
			this.internalFiles = [];
			this.$emit("update:modelValue", null);
			this.$emit("cleared");
			// Reset native input so the same file can be re-selected
			if (this.$refs.fileInput) {
				this.$refs.fileInput.value = "";
			}
		},
		formatBytes(bytes) {
			if (!bytes && bytes !== 0) return "—";
			const sizes = ["B", "KB", "MB", "GB", "TB"];
			const i = Math.floor(Math.log(bytes) / Math.log(1024));
			const value = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2);
			return `${value} ${sizes[i]}`;
		},
	},
};
</script>

<style scoped>
@reference "../../theme.css";

.gradientbg {
	@apply to-50%;
	background-size: 200% 100%;
	background-position: 0% 0%;
	transition: background-position 200ms ease;
}

.gradientbg:hover {
	background-position: 50% 0%;
}
</style>
