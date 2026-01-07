<template>
	<div class="p-4">
		<label class="text-cream font-main font-bold text-center bg-linear-to-r from-teal-4 to-teal-1 p-4 w-full cursor-pointer rounded-lg flex items-center gradientbg select-none">
			<p class="w-full text-center">CHOOSE FILE</p>
			<input 
				ref="fileInput" 
				type="file" 
				class="w-full text-white-0 bg-gray-2 rounded px-3 py-2 cursor-pointer hidden" 
				:accept="accept"
				@change="onChange" 
			/>
		</label>

		<div v-if="internalFile" class="mt-4 bg-gray-5 rounded-lg p-3">
			<p class="font-main font-bold text-sm text-teal-4">PICKED FILE</p>
			<div class="mt-2 font-mono text-white-0 text-sm">
				<p class="truncate">Name: {{ internalFile.name }}</p>
				<p>Type: {{ internalFile.type || "unknown" }}</p>
				<p>Size: {{ formatBytes(internalFile.size) }}</p>
			</div>
			<FlexButton class="mt-3" :variant="BTN_VARIANT.DANGER" @input="clearFile">
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
			type: File,
			default: null,
		},
		accept: {
			type: String,
			default: "*"
		}
	},
	emits: ["update:modelValue", "cleared"],
	data() {
		return {
			BTN_VARIANT,
			internalFile: this.modelValue,
		};
	},
	watch: {
		modelValue(val) {
			this.internalFile = val;
		},
	},
	methods: {
		onChange(e) {
			const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
			this.internalFile = file;
			this.$emit("update:modelValue", file);
		},
		clearFile() {
			this.internalFile = null;
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
