<template>
	<div class="p-4">
		<label class="text-cream font-main font-bold text-center bg-linear-to-r from-teal-4 to-teal-1 p-4 w-full cursor-pointer rounded-lg flex items-center gradientbg select-none">
			<p class="w-full text-center">{{ isFolder ? 'CHOOSE FOLDER' : 'CHOOSE FILE' }}</p>
			<input 
				ref="fileInput" 
				type="file" 
				class="w-full text-white-0 bg-gray-2 rounded px-3 py-2 cursor-pointer hidden" 
				:accept="accept"
				:webkitdirectory="isFolder"
				@change="onChange" 
				multiple
			/>
		</label>

		<div v-if="internalFiles && internalFiles.length > 0" class="mt-4 bg-gray-5 rounded-lg p-3">
			<p class="font-main font-bold text-sm text-teal-4">{{ isFolder ? 'PICKED FOLDER' : 'PICKED FILES' }}</p>
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

export default {
	components: {
		FlexButton,
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
		}
	},
	watch: {
		modelValue(val) {
			this.internalFiles = Array.isArray(val) ? val : (val ? [val] : []);
		},
	},
	methods: {
		onChange(e) {
			const files = e.target.files ? Array.from(e.target.files) : [];
			this.internalFiles = files;
			// For folder mode, emit array; for single file mode, emit single or array based on length
			const value = this.isFolder ? files : (files.length === 1 ? files[0] : files);
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
