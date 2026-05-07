<template>
	<StatusTile 
		v-if="selectedInstanceData.state === 'ONLINE'"
		:perm-required="[PERMISSIONS.instance.files.read, PERMISSIONS.instance.files.write]"
		collapsible
		class="mt-4 sm:mt-8"
	>
		<template #header>
			<Icon icon="folder-open" color="text-gray-6" size="5" />
			<p class="text-gray-6 ml-2 text-lg">Files</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">{{ fileLocationCount }} folder{{ plural(fileLocationCount) }}</p>
		</template>
		<template #content>
			<FlexButton 
				class="bg-gray-4 hover:bg-gray-2 w-max pl-4 pr-6 py-2 mt-4 ml-4" 
				@input="syncInstanceFiles(selectedInstanceData.id)"
				:disabled="loading.fileUpload"
			>
				<div class="flex items-center">
					<Spinner v-if="loading.fileUpload" class="h-4 w-4 text-teal-3" thickness="4" />
					<Icon v-else icon="sync" color="text-teal-3" size="5" />
					<p class="text-teal-3 ml-2 font-main font-bold">RESYNC FILES</p>
				</div>
			</FlexButton>

			<div class="flex flex-col sm:grid grid-cols-2 m-4 gap-4">
				<template v-for="(path, nickname) in filePathLocations">
					<div class="bg-gray-5 rounded-xl p-4 h-max">
						<div class="rounded-full flex items-center font-mono text-teal-4 bg-gray-1 px-4 py-1 grow">
							<p class="text-sm">{{ readPathsAuth ? path : nickname }}/</p>
						</div>

						<FileHierarchy 
							class="mt-4 -ml-4"
							:files="instanceFiles[path]"
							@deleteClicked="($e) => openConfirmDeletePopup($e, path)"
							@addClicked="($e) => openFileUploadPopup($e, path)"
						/>
					</div>
				</template>
			</div>
		</template>
	</StatusTile>

	<Popup
		:open="isFilePickerOpen"
		header-text="UPLOAD FILE"
		body-class="w-11/12 sm:w-1/4 h-max"
		@xClicked="cancelFilePicker"
		:setState="onFileCleared"
		:buttons="[
			{ variant: BTN_VARIANT.DANGER, text: 'CANCEL', onClick: cancelFilePicker },
			{ variant: BTN_VARIANT.PRIMARY, text: 'UPLOAD', onClick: uploadFile, disabled: loading.fileUpload },
		]"
	>
		<div class="p-4">
			<div class="flex items-center font-semibold text-white-0 flex-wrap">
				<p class="font-main mr-1 mb-1">Upload file to</p>
				<div class="bg-gray-2 rounded px-2 font-mono break-all text-sm">{{ addFilePathRoot + "/" + addFilePath.join("/")}}</div>
			</div>
			<div>
				<p class="font-main font-semibold text-white-0 my-2">Choose a file or folder to upload.</p>
			</div>
			
			<!-- Toggle between file and folder mode -->
			<div class="flex items-center mb-4 gap-2">
				<Checkbox v-model="uploadFolderMode" class="h-5 w-5" />
				<p class="font-main font-semibold text-teal-4 cursor-pointer" @click="uploadFolderMode = !uploadFolderMode">Folder upload</p>
			</div>

			<p v-if="uploadFolderMode" class="font-main font-semibold text-white-0">Note: This will upload the selected folder as well.</p>

			<FilePicker 
				v-model="pickedFile" 
				@cleared="onFileCleared" 
				:is-folder="uploadFolderMode"
			/>
			<div v-if="loading.fileUpload" class="flex items-center mt-4 justify-center">
				<Spinner class="h-5 w-5 text-teal-3 mr-2"/>
				<p class="font-main font-bold text-teal-4">Uploading...</p>
			</div>
		</div>
	</Popup>

	<Popup
		body-class="h-1/3 w-11/12 sm:w-1/2 lg:w-1/4"
		header-text="CONFIRM"
		:open="confirmDeletePopupOpen"
		@x-clicked="confirmDeletePopupOpen = false"
		:buttons="[
			{ variant: BTN_VARIANT.PRIMARY, text: 'CANCEL', onClick: () => { confirmDeletePopupOpen = false } },
			{ variant: BTN_VARIANT.DANGER, text: 'DELETE', onClick: deleteFile },
		]"
	>
		<div class="p-4 h-full w-full flex flex-col text-center justify-center items-center font-main font-bold">
			<p class="text-white-0 py-2">
				Are you sure you want to delete 
				{{ deleteDetails.isFolder ? 'this folder? This includes any files and folders in it.' : 'this file?' }}
			</p>
			<div class="bg-gray-2 rounded px-2 font-mono break-all text-sm text-white-0">{{ deleteDetails.pathRoot + "/" + deleteDetails.path.join("/") }}</div>
		</div>
	</Popup>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { deleteRequest, post, put } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { plural } from '../../../../util/format';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Checkbox from '../../../common/Checkbox.vue';
import FileHierarchy from '../../../common/FileHierarchy.vue';
import FilePicker from '../../../common/FilePicker.vue';
import Popup from '../../../common/Popup.vue';


export default {
	mixins: [],
	components: {
		FileHierarchy,
		Popup,
		FilePicker,
		Checkbox,
	},
	props: {
		selectedInstanceData: {
			type: Object,
			required: true
		},
		loading: {
			type: Object,
			required: true,
		}
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			isFilePickerOpen: false,
			pickedFile: [],
			addFilePath: null,
			addFilePathRoot: null,
			uploadFolderMode: false,
			deleteDetails: {
				path: null,
				isFolder: false,
				pathRoot: ""
			},
			confirmDeletePopupOpen: false,
		}
	},
	computed: {
		instanceFiles() {
			const roots = Object.values(this.serverStore.instanceFileRoots[this.selectedInstanceData.id] ?? []);
			const existingFiles = (this.serverStore.instanceFiles[this.selectedInstanceData.id] || [])
				.map(d => d.key)
				.filter(p => roots.some(root => p.startsWith(`${this.selectedInstanceData.id}${root}/`)))
				.map(s => s.replace(this.selectedInstanceData.id, ""));

			const sortedFiles = Object.fromEntries(roots.map(r => [r, []]));
			existingFiles.forEach(path => {
				roots.forEach(root => {
					if (path.startsWith(`${root}/`)) {
						let shortPath = path.replace(root, "");
						if (shortPath[0] === "/") {
							shortPath = shortPath.slice(1);
						}
						sortedFiles[root].push(shortPath);
					}
				});
			});

			return sortedFiles;
		},
		fileLocationCount() {
			return Object.keys(this.filePathLocations || {})?.length || 0;
		},
		instancePaths() {
			return this.serverStore.instanceFileRoots[this.selectedInstanceData.id];
		},
		readPathsAuth() {
			return this.$checkPermissions(PERMISSIONS.instance.files.paths.read);
		},
		filePathLocations() {
			return Object.fromEntries(Object.entries(this.instancePaths || {}).filter(([pname, _]) => this.$checkResourceAccess(`filepath::${pname}`)));
		}
	},
	methods: {
		plural,
		cancelFilePicker() {
			this.isFilePickerOpen = false;
			this.addFilePath = null;
			this.addFilePathRoot = null;
			this.uploadFolderMode = false;
			this.onFileCleared();
		},

		openConfirmDeletePopup(data, root) {
			this.confirmDeletePopupOpen = true;
			this.deleteDetails = {
				...data,
				pathRoot: root
			};
		},

		onFileCleared() {
			this.pickedFile = null;
		},

		openFileUploadPopup(atPath, pathRoot) {
			this.addFilePath = atPath;
			this.addFilePathRoot = pathRoot;
			this.isFilePickerOpen = true;
		},

		async uploadFile() {
			this.$validatePermissions(PERMISSIONS.instance.files.write);

			const instanceID = this.selectedInstanceData.id;

			if (!this.pickedFile || this.pickedFile.length === 0 || this.loading.fileUpload) return;
			this.loading.fileUpload = true;

			try {
				const files = Array.isArray(this.pickedFile) ? this.pickedFile : [this.pickedFile];
				const uploadPromises = [];

				// Upload each file concurrently
				for (const file of files) {
					uploadPromises.push(this.uploadSingleFile(file));
				}

				const results = await Promise.allSettled(uploadPromises);
				
				// Check for any failures
				const failures = results.filter(r => r.status === 'rejected');
				const successes = results.filter(r => r.status === 'fulfilled');

				if (failures.length > 0) {
					this.$alert.warning(`Uploaded ${successes.length}/${files.length} files. ${failures.length} failed.`);
				} else {
					this.$alert.success(`Successfully uploaded ${successes.length} file(s)`);
				}

				this.cancelFilePicker();

				// Step 3: Refresh file list
				if (this.$checkPermissions(PERMISSIONS.instance.files.read)) {
					await this.fetchInstanceFiles(instanceID);
				}

				this.syncInstanceFiles(instanceID);
			} catch (e) {
				this.$alert.error("Error uploading files");
				this.loading.fileUpload = false;
				console.error(e);
			}
		},

		async uploadSingleFile(file) {
			// Get the relative path of the file (for files from folder picker)
			const relativePath = file.webkitRelativePath || file.name;
			
			// Split path into components and construct final path
			const pathParts = relativePath.split('/');
			const fileName = pathParts.pop(); // Last part is filename

			// Request pre-signed URL from backend
			const response = await post(`/instance/${this.selectedInstanceData.id}/files`, PERMISSIONS.instance.files.write, {
				pathRoot: this.addFilePathRoot,
				path: this.addFilePath.concat(pathParts).join("/"),
				fileName: fileName,
			});

			const {uploadUrl} = response;

			// Upload file directly to S3 using pre-signed URL
			const uploadResponse = await fetch(uploadUrl, {
				method: "PUT",
				body: file,
			});

			if (!uploadResponse.ok) {
				throw new Error(`S3 upload failed for ${relativePath}: ${uploadResponse.statusText}`);
			}
		},

		async syncInstanceFiles(instanceID) {
			this.$validatePermissions(PERMISSIONS.instance.files.write);

			this.loading.fileUpload = true;

			try {
				await put(`/instance/${instanceID}/files`, PERMISSIONS.instance.files.write);
				this.$alert.success("File sync complete");
			} catch (e) {
				this.$alert.error("Error syncing instance files. Files may be in an invalid state. Please alert @havoc immediately.", { duration: 30000 });
				console.error(e);
			} finally {
				this.loading.fileUpload = false;
			}
		},

		async fetchInstanceFiles(instanceID) {
			this.$validatePermissions(PERMISSIONS.instance.files.read);

			try {
				await this.serverStore.fetchInstanceFiles(instanceID);
			} catch (e) {
				this.$alert.error("Error fetching instance files");
				console.error(e);
			}
		},

		async deleteFile() {
			this.confirmDeletePopupOpen = false;
			this.$validatePermissions(PERMISSIONS.instance.files.write);

			if (this.loading.fileUpload) return;
			this.loading.fileUpload = true;

			try {
				await post(`/instance/${this.selectedInstanceData.id}/files/delete`, PERMISSIONS.instance.files.write, {
					pathRoot: this.deleteDetails.pathRoot,
					path: this.deleteDetails.path.slice(0, -1).join("/"),
					fileName: this.deleteDetails.path[this.deleteDetails.path.length - 1],
					isFolder: this.deleteDetails.isFolder
				});
				this.$alert.success("File deleted");
				this.fetchInstanceFiles(this.selectedInstanceData.id);
			} catch (e) {
				this.$alert.error("Error deleting file");
				console.error(e);
			} finally {
				this.loading.fileUpload = false;
			}
		}
	},
}
</script>

<style scoped>

</style>
