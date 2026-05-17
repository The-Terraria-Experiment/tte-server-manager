<template>
	<div>
		<StatusTile
			:class="['mt-4 sm:mt-8']"
			collapsible
			:perm-required="PERMISSIONS.server.config.read"
			:loading="loadingSaveConfig || loadingFile"
		>
			<template #header>
				<Icon icon="gear" color="text-gray-6" size="5" />
				<p class="text-gray-6 ml-2 text-lg">Other Configs</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ summaryText }}</p>
			</template>
			<template #content>
				<div class="flex px-4 pb-4 gap-2">
					<div class="bg-gray-2 rounded-md p-3 w-full">
						<p class="font-main font-bold text-gray-7">FIND CONFIG FILE</p>
						<div class="flex gap-4 flex-wrap mt-4">
							<Dropdown
								placeholder="Choose parent folder..."
								class="sm:max-w-1/4"
								inputClass="bg-teal-3 text-white-1"
								iconColor="text-white-1"
								:options="fileRootOptions"
								v-model="searchRoot"
							/>
							<FlexButton
								:variant="BTN_VARIANT.SECONDARY"
								leftIcon="folder-tree"
								leftIconSize="5"
								:disabled="!searchRoot"
								@input="openPicker"
							>
								PICK FILE
							</FlexButton>
						</div>
						<div class="mt-4 flex items-center">
							<p class="font-main font-bold text-gray-7">SELECTED FILE: </p>
							<div class="bg-gray-1 rounded px-2 py-1 ml-2 font-mono text-sm text-white-1 break-all">{{ !!selectedRelativePath ? selectedFilePath : "None" }}</div>
						</div>
					</div>
				</div>

				<div v-if="selectedRelativePath" class="px-4 pb-4">
					<div class="flex gap-3 flex-wrap">
						<FlexButton
							:variant="BTN_VARIANT.SECONDARY"
							leftIcon="edit"
							leftIconSize="5"
							:disabled="loadingFile || loadingSaveConfig || !selectedRelativePath"
							@input="openEditor"
						>
							EDIT FILE
						</FlexButton>

						<FlexButton
							:variant="BTN_VARIANT.SECONDARY"
							leftIcon="upload"
							leftIconSize="4"
							:disabled="loadingFile || loadingSaveConfig || !selectedRelativePath"
							@input="refreshFromInstance"
						>
							REFRESH FROM INSTANCE
						</FlexButton>
					</div>

					<div v-if="loadingFile" class="flex items-center justify-end mt-4">
						<Spinner class="h-5 w-5 text-teal-3" />
						<p class="font-main font-bold text-teal-4 mx-2">LOADING...</p>
					</div>
				</div>

				<CodeEditor
					:open="editorOpen"
					v-model="fileContent"
					:language="editorLanguage"
					@cancel="editorOpen = false"
					@save="saveAndCloseEditor"
				/>

				<div v-if="loadingSaveConfig" class="flex items-center justify-end mt-4 mr-4 mb-4">
					<Spinner class="h-5 w-5 text-teal-3" />
					<p class="font-main font-bold text-teal-4 mx-2">SAVING...</p>
				</div>
			</template>
		</StatusTile>

		<FileBrowser 
			:open="pickerOpen" 
			:root="searchRoot ?? null"
			@picked="filePicked"
			@close="pickerOpen = false"
		/>
	</div>
</template>

<script>
import CodeEditor from '@/components/common/CodeEditor.vue';
import Dropdown from '@/components/common/Dropdown.vue';
import FileBrowser from '@/components/common/FileBrowser.vue';
import FlexButton from '@/components/common/FlexButton.vue';
import Spinner from '@/components/common/Spinner.vue';
import { useServerStore } from '@/stores/serverStore';
import { post, put } from '@/util/api';
import { BTN_VARIANT } from '@/util/constants';
import { PERMISSIONS } from '@/util/permissionValues';


export default {
	mixins: [],
	components: {
		CodeEditor,
		Dropdown,
		FileBrowser,
		FlexButton,
		Spinner,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			loadingSaveConfig: false,
			loadingFile: false,
			searchRoot: null,
			pickerOpen: false,
			selectedRelativePath: null,
			fileContent: "",
			editorOpen: false,
		}
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		summaryText() {
			return this.selectedFileName
				? `Loaded "${this.selectedFileName}"`
				: "No file selected";
		},
		selectedFileName() {
			if (!this.selectedRelativePath) return "";
			const parts = this.selectedRelativePath.split("/");
			return parts[parts.length - 1] || "";
		},
		selectedFilePath() {
			if (!this.selectedRelativePath || !this.searchRoot) return "";
			return `${this.searchRoot}/${this.selectedRelativePath}`;
		},
		editorLanguage() {
			const name = this.selectedFileName.toLowerCase();
			if (name.endsWith(".json")) return "json";
			if (name.endsWith(".yml") || name.endsWith(".yaml")) return "yaml";
			return "text";
		},
		fileRootOptions() {
			const allPathRoots = this.serverStore.instanceFileRoots[this.selectedInstance] ?? [];
			const allowedPathRoots = Object.keys(allPathRoots).filter(pname => this.$checkResourceAccess(`filepath::${this.selectedInstance}::${pname}`));
			return allowedPathRoots.map(r => ({ id: r, text: r }));
		},
	},
	methods: {
		openPicker() {
			this.pickerOpen = true;
		},
		openEditor() {
			if (!this.selectedRelativePath) return;
			this.editorOpen = true;
		},
		saveAndCloseEditor() {
			this.editorOpen = false;
			this.saveFile();
		},
		normalizePickedPath(path) {
			if (Array.isArray(path)) return path.join("/");
			if (typeof path === "string") return path.trim();
			return "";
		},
		filePicked(path) {
			const relativePath = this.normalizePickedPath(path);
			if (!relativePath) {
				this.$alert.error("Invalid file selection");
				return;
			}
			this.selectedRelativePath = relativePath;
			this.fetchFileContent({ forceRefresh: false });
		},
		async refreshFromInstance() {
			this.fetchFileContent({ forceRefresh: true });
		},
		async fetchFileContent({ forceRefresh = false } = {}) {
			this.$validatePermissions(PERMISSIONS.server.config.read);
			if (!this.selectedInstance || !this.searchRoot || !this.selectedRelativePath || this.loadingFile) return;

			this.loadingFile = true;
			try {
				const data = await post(`/instance/${this.selectedInstance}/files/content`, PERMISSIONS.server.config.read, {
					rootName: this.searchRoot,
					relativePath: this.selectedRelativePath,
					forceRefresh,
				});
				this.fileContent = data.content ?? "";
				this.editorOpen = true;
			} catch (e) {
				this.$alert.error("Error loading file");
				console.error(e);
			} finally {
				this.loadingFile = false;
			}
		},
		async saveFile() {
			this.$validatePermissions(PERMISSIONS.server.config.write);
			if (!this.selectedInstance || !this.searchRoot || !this.selectedRelativePath || this.loadingSaveConfig) return;

			this.loadingSaveConfig = true;
			try {
				await put(`/instance/${this.selectedInstance}/files/content`, PERMISSIONS.server.config.write, {
					rootName: this.searchRoot,
					relativePath: this.selectedRelativePath,
					content: this.fileContent,
				});
				this.$alert.success("File saved");
			} catch (e) {
				this.$alert.error("Error saving file");
				console.error(e);
			} finally {
				this.loadingSaveConfig = false;
			}
		},
	},
	mounted() {
		
	},
	watch: {
		searchRoot() {
			this.selectedRelativePath = null;
			this.fileContent = "";
			this.editorOpen = false;
		},
		selectedInstance() {
			this.selectedRelativePath = null;
			this.fileContent = "";
			this.editorOpen = false;
		}
	}
}
</script>

<style scoped>

</style>
