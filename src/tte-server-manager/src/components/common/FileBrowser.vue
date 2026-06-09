<template>
	<div>
		<Popup
			headerText="PICK CONFIG FILE"
			:open="open"
			@x-clicked="$emit('close')"
		>
			<div v-if="loadingFiles" class="flex items-center justify-center h-full w-full text-white-0 font-main font-bold">
				<Spinner class="h-5 w-5" />
				<p class="ml-4">Loading instance files...</p>
			</div>
			<div v-else>
				<div class="rounded-xl p-4 h-max">
					<div class="flex items-center justify-between gap-3">
						<div class="rounded-full flex items-center font-mono text-teal-4 bg-gray-1 px-4 py-1 grow">
							<p>{{ fileData.tree.name }}/</p>
						</div>
						<FlexButton
							class="text-sm"
							:variant="BTN_VARIANT.SECONDARY"
							:leftIcon="'arrow-rotate-right'"
							leftIconSize="4"
							:disabled="loadingFiles"
							@input="forceRefresh"
						>
							REFRESH
						</FlexButton>
					</div>
					<div class="bg-gray-5 rounded-xl p-2 mt-2">
						<FileHierarchy
							class="-ml-4"
							:files="fileDigest"
							:editable="false"
							@picked="filePicked"
						/>
					</div>
				</div>
			</div>
		</Popup>
	</div>
</template>

<script>
import { post } from '@/util/api';
import FileHierarchy from './FileHierarchy.vue';
import FlexButton from './FlexButton.vue';
import Popup from './Popup.vue';
import { useServerStore } from '@/stores/serverStore';
import Spinner from './Spinner.vue';
import { PERMISSIONS } from '@/util/permissionValues';
import { BTN_VARIANT } from '@/util/constants';


export default {
	mixins: [],
	components: {
		Popup,
		FileHierarchy,
		FlexButton,
	},
	props: {
		open: {
			type: Boolean,
			required: true
		},
		root: {
			type: [String, null],
			required: true
		},
		disallow: {
			type: Set,
			required: false,
			default: () => new Set
		}
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			loadingFiles: true,
			fileData: null,
			fileCache: {}
		}
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		fileDigest() {
			const paths = [];

			const traverse = (level) => {
				if (level.children) {
					level.children.forEach(child => {
						if (child.type === "file" && !this.disallow.has(`${this.fileData.rootPath}/${child.path}`)) {
							paths.push(child.path);
						}

						if (child.children) {
							traverse(child);
						}
					});
				}
			};

			traverse(this.fileData.tree);

			return paths;
		}
	},
	methods: {
		getCacheKey() {
			return `${this.selectedInstance ?? 'unknown'}::${this.root ?? 'root'}`;
		},
		async fetchFiles({ force = false } = {}) {
			const cacheKey = this.getCacheKey();
			const cached = this.fileCache[cacheKey];
			if (!force && cached) {
				this.fileData = cached;
				this.loadingFiles = false;
				return;
			}
			this.loadingFiles = true;
			try {
				const data = await post(`/instance/${this.selectedInstance}/files/tree`, PERMISSIONS.server.config.read, {
					rootName: this.root,
					accept: [".json", ".yaml", ".yml"]
				});
				this.fileData = data;
				this.fileCache[cacheKey] = data;
			} catch (e) {
				this.$alert.error("Failed to fetch instance files");
				this.$emit("close");
			} finally {
				this.loadingFiles = false;
			}
		},
		forceRefresh() {
			this.fetchFiles({ force: true });
		},
		filePicked({ path }) {
			this.$emit("picked", path);
			this.$emit("close");
		}
	},
	watch: {
		open(value) {
			if (value) {
				this.fetchFiles();
			}
		}
	}
}
</script>

<style scoped>

</style>
