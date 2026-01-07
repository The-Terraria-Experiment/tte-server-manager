<template>
	<div 
		v-if="$checkPermissions(PERMISSIONS.instance.list) && !serverStore.isLoadingList && serverStore.instanceOptions?.length"
		class="bg-gray-3 p-4 rounded-xl"
	>
		<p class="font-main font-bold text-gray-7 mb-2">VIEW INSTANCE</p>
		<Dropdown 
			:options="serverStore.instanceOptions"
			v-model="selectedInstance"
			inputClass="bg-teal-3 text-white-1"
			iconColor="text-white-1"
		/>

		<RefreshButton :loading="serverStore.isLoadingStatus(selectedInstance)" @input="fetchInstanceStatus(selectedInstance)" />
	</div>
	
	<StatusTile v-else-if="!serverStore.isLoadingList && !serverStore.instanceOptions.length">
		<template #header>
			<Icon icon="warning" color="text-yellow-2" size="4" />
			<p class="text-yellow-2 ml-2 text-lg">No Data</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">No instances to show</p>
		</template>
	</StatusTile>

	<div class="flex flex-col sm:grid sm:grid-cols-4">
		<StatusTile 
			:class="['grow mt-4 sm:mt-8 sm:mr-1', selectedInstanceData.state === 'ONLINE' ? 'gradient-tile-green' : 'gradient-tile-red']" 
			:collapsible="['ONLINE', 'OFFLINE'].includes(selectedInstanceData.state)"
			:perm-required="PERMISSIONS.instance.status.read"
			display-if-not-allowed
		>
			<template #header>
				<Icon icon="power" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Instance Status</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">{{ selectedInstanceData.state }}</p>
					<Spinner v-if="loading.stateChange" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
			<template #content>
				<div v-if="selectedInstanceData.state === 'ONLINE'">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.instance.status.stop) && !loading.stateChange"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.DANGER"
						@input="stopInstance"
					>
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.instance.status.restart) && !loading.stateChange"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.DANGER"
						@input="restartInstance"
					>
						<p class="py-2 px-12">RESTART</p>
					</FlexButton>
				</div>
				<div v-if="selectedInstanceData.state === 'OFFLINE'">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.instance.status.start) && !loading.stateChange"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.PRIMARY"
						@input="startInstance"
					>
						<p class="py-2 px-12">START</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:perm-required="PERMISSIONS.instance.status.read"
		>
			<template #header>
				<Icon icon="clock" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Instance Uptime</p>
			</template>
			<template #summary>
				<ActiveDate 
					v-if="selectedInstanceData.timeOnline" 
					:date="selectedInstanceData.timeOnline"
					class-name="font-main font-bold text-teal-4 text-2xl"
				/>
				<p v-else class="text-2xl text-teal-4">Unknown</p>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:perm-required="PERMISSIONS.instance.status.read"
		>
			<template #header>
				<Icon icon="network" color="text-gray-6" size="5" />
				<p class="text-gray-6 ml-2 text-lg">IP Address</p>
			</template>
			<template #summary>
				<p v-if="selectedInstanceData.publicIp" class="text-2xl text-teal-4">{{ selectedInstanceData.publicIp }}</p>
				<p v-else class="text-2xl text-teal-4">Unknown</p>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:ml-1 gradient-tile"
			:perm-required="PERMISSIONS.instance.status.read"
		>
			<template #header>
				<Icon icon="microchip" color="text-gray-6" size="5" />
				<p class="text-gray-6 ml-2 text-lg">Instance Type</p>
			</template>
			<template #summary>
				<p v-if="selectedInstanceData.instanceType" class="text-2xl text-teal-4">{{ selectedInstanceData.instanceType }}</p>
				<p v-else class="text-2xl text-teal-4">Unknown</p>
			</template>
		</StatusTile>
	</div>

	<StatusTile 
		:perm-required="[PERMISSIONS.instance.files.read, PERMISSIONS.instance.files.write]"
		collapsible
		class="mt-4 sm:mt-8"
	>
		<template #header>
			<Icon icon="folder-open" color="text-gray-6" size="5" />
			<p class="text-gray-6 ml-2 text-lg">Files</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">2 folders</p>
		</template>
		<template #content>
			<div class="flex flex-col sm:grid grid-cols-2 m-4">
				<div class="bg-gray-5 rounded-xl p-4 sm:mr-2 h-max">
					<div class="rounded-full flex items-center font-mono text-teal-4 bg-gray-1 px-4 py-1 grow">
						<p class="text-sm">{{ PLUGINS_PATH }}/</p>
					</div>

					<FileHierarchy 
						class="mt-4 -ml-4"
						:files="instancePluginFiles"
						@deleteClicked="(data) => { }"
						@addClicked="($e) => openFileUploadPopup($e, PLUGINS_PATH)"
					/>
				</div>

				<div class="bg-gray-5 rounded-xl p-4 sm:mr-2 h-max">
					<div class="rounded-full flex items-center font-mono text-teal-4 bg-gray-1 px-4 py-1 grow">
						<p class="text-sm">{{ WORLDS_PATH }}/</p>
					</div>

					<FileHierarchy 
						class="mt-4 -ml-4"
						:files="instanceWorldFiles"
						@deleteClicked="(data) => { }"
						@addClicked="($e) => openFileUploadPopup($e, WORLDS_PATH)"
					/>
				</div>

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
	
</template>

<script>
import { BTN_VARIANT, PLUGINS_PATH, WORLDS_PATH } from '../../util/constants';
import Dropdown from '../common/Dropdown.vue';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import StatusTile from '../common/StatusTile.vue';
import Spinner from "../common/Spinner.vue";
import ActiveDate from '../common/ActiveDate.vue';
import { PERMISSIONS } from '../../util/permissionValues';
import { post } from '../../util/api';
import NotAllowed from '../common/NotAllowed.vue';
import RefreshButton from '../common/RefreshButton.vue';
import delay from '../../util/delay';
import { useServerStore } from '../../stores/serverStore';
import FileHierarchy from '../common/FileHierarchy.vue';
import Popup from '../common/Popup.vue';
import FilePicker from '../common/FilePicker.vue';
import Checkbox from "../common/Checkbox.vue"

export default {
	mixins: [],
	components: {
		Dropdown,
		StatusTile,
		FlexButton,
		Icon,
		Spinner,
		ActiveDate,
		NotAllowed,
		RefreshButton,
		FileHierarchy,
		Popup,
		FilePicker,
		Checkbox
	},
	props: {
		
	},
	data() {
		return {
			BTN_VARIANT,
			PERMISSIONS,
			PLUGINS_PATH,
			WORLDS_PATH,
			selectedInstance: null,
			serverStore: useServerStore(),
			loading: {
				stateChange: false,
				fileUpload: false,
			},
			isFilePickerOpen: false,
			pickedFile: [],
			addFilePath: null,
			addFilePathRoot: null,
			uploadFolderMode: false,
		}
	},
	computed: {
		selectedInstanceData() {
			const rawData = this.serverStore.getInstanceData(this.selectedInstance);
			if (!rawData) return {
				state: "UNKNOWN",
				publicIp: null,
				timeOnline: null,
				instanceType: null
			};

			const stateMap = {
				"pending": "STARTING",
				"running": "ONLINE",
				"shutting-down": "SHUTTING DOWN",
				"terminated": "TERMINATED",
				"stopping": "STOPPING",
				"stopped": "OFFLINE"
			};

			return {
				state: stateMap[rawData.state],
				publicIp: rawData.publicIp,
				timeOnline: (rawData.launchTime && rawData.state === 'running') ? new Date(rawData.launchTime) : null,
				instanceType: rawData.instanceType
			};
		},
		instancePluginFiles() {
			return (this.serverStore.instanceFiles[this.selectedInstance] || [])
				.map(d => d.key)	
				.filter(p => p.startsWith(this.selectedInstance + PLUGINS_PATH))
				.map(s => s.replace(this.selectedInstance + PLUGINS_PATH + "/", ""));
		},
		instanceWorldFiles() {
			return (this.serverStore.instanceFiles[this.selectedInstance] || [])
				.map(d => d.key)	
				.filter(p => p.startsWith(this.selectedInstance + WORLDS_PATH))
				.map(s => s.replace(this.selectedInstance + WORLDS_PATH + "/", ""));
		},
	},
	methods: {
		cancelFilePicker() {
			this.isFilePickerOpen = false;
			this.addFilePath = null;
			this.addFilePathRoot = null;
			this.uploadFolderMode = false;
			this.onFileCleared();
		},
		onFileCleared() {
			this.pickedFile = null;
		},
		/*=======================================================================================
		                                          Fetch                                          
		=======================================================================================*/
		async fetchInstanceList() {
			this.$validatePermissions(PERMISSIONS.instance.list);

			try {
				const instances = await this.serverStore.fetchInstanceList();
				this.selectedInstance = instances[0]?.id || undefined;
			} catch (e) {
				this.$alert.error("Error fetching instance list");
				console.error(e);
			}
		},
		async fetchInstanceStatus(instanceID) {
			this.$validatePermissions(PERMISSIONS.instance.status.read);

			try {
				await this.serverStore.fetchInstanceStatus(instanceID);
			} catch (e) {
				this.$alert.error("Error fetching instance status");
				console.error(e);
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
		/*=======================================================================================
		                                  Start/Stop/Restart                                     
		=======================================================================================*/
		async stopInstance() {
			this.$validatePermissions(PERMISSIONS.instance.status.stop);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstance).text;
				const response = await post(`/instance/${this.selectedInstance}/stop`, PERMISSIONS.instance.status.stop);
				await delay(2000);
				this.$alert.info(`Initiated shutdown of instance '${instanceName}'`);
				this.fetchInstanceStatus(this.selectedInstance);
			} catch (e) {
				this.$alert.error("Error initiating instance shutdown");
				console.error(e);
			} finally {
				this.loading.stateChange = false;
			}
		},
		async startInstance() {
			this.$validatePermissions(PERMISSIONS.instance.status.start);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstance).text;
				const response = await post(`/instance/${this.selectedInstance}/start`, PERMISSIONS.instance.status.start);
				await delay(2000);
				this.$alert.info(`Initiated startup of instance '${instanceName}'`);
				this.fetchInstanceStatus(this.selectedInstance);
			} catch (e) {
				this.$alert.error("Error initiating instance startup");
				console.error(e);
			} finally {
				this.loading.stateChange = false;
			}
		},
		async restartInstance() {
			this.$validatePermissions(PERMISSIONS.instance.status.restart);

			if (this.loading.stateChange) return;
			this.loading.stateChange = true;

			try {
				const instanceName = this.serverStore.instanceOptions.find(o => o.id === this.selectedInstance).text;
				const response = await post(`/instance/${this.selectedInstance}/restart`, PERMISSIONS.instance.status.restart);
				await delay(2000);
				this.$alert.info(`Initiated restart of instance '${instanceName}'`);
				this.fetchInstanceStatus(this.selectedInstance);
			} catch (e) {
				this.$alert.error("Error initiating instance restart");
				console.error(e);
			} finally {
				this.loading.stateChange = false;
			}
		},
		/*=======================================================================================
		                                      File uploading                                      
		=======================================================================================*/
		openFileUploadPopup(atPath, pathRoot) {
			this.addFilePath = atPath;
			this.addFilePathRoot = pathRoot;
			this.isFilePickerOpen = true;
		},
		async uploadFile() {
			this.$validatePermissions(PERMISSIONS.instance.files.write);

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
					await this.fetchInstanceFiles(this.selectedInstance);
				}
			} catch (e) {
				this.$alert.error("Error uploading files");
				console.error(e);
			} finally {
				this.loading.fileUpload = false;
			}
		},

		async uploadSingleFile(file) {
			// Get the relative path of the file (for files from folder picker)
			const relativePath = file.webkitRelativePath || file.name;
			
			// Split path into components and construct final path
			const pathParts = relativePath.split('/');
			const fileName = pathParts.pop(); // Last part is filename
			const pathString = pathParts.length > 0 ? pathParts.join("/") : "";

			// Request pre-signed URL from backend
			const response = await post(`/instance/${this.selectedInstance}/files`, PERMISSIONS.instance.files.write, {
				pathRoot: this.addFilePathRoot.substring(1),
				path: pathString,
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
		}
	},
	async mounted() {
		if (this.$checkPermissions(PERMISSIONS.instance.list)) {
			await this.fetchInstanceList();
			if (this.$checkPermissions(PERMISSIONS.instance.files.read)) {
				this.fetchInstanceFiles(this.selectedInstance);
			}
		}
	},
	watch: {
		selectedInstance(value) {
			if (!this.serverStore.getInstanceData(value) && !this.serverStore.isLoadingStatus(value)) {
				this.fetchInstanceStatus(value);
			}
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";

.gradient-tile-green {
	@apply bg-linear-to-b from-gray-3 to-green-2 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
}

.gradient-tile-red {
	@apply bg-linear-to-b from-gray-3 to-red-900 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
}
</style>
