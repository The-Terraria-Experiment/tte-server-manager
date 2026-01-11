<template>
	<StatusTile 
		v-if="selectedInstanceData.state === 'ONLINE'"
		:perm-required="[PERMISSIONS.instance.files.read, PERMISSIONS.instance.files.paths.read, PERMISSIONS.instance.files.paths.write]"
		collapsible
		class="mt-4 sm:mt-8"
		:loading="saveLoading"
	>
		<template #header>
			<Icon icon="folder-open" color="text-gray-6" size="5" />
			<p class="text-gray-6 ml-2 text-lg">File Locations</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">{{ fileLocationCount }} file location{{ plural(fileLocationCount) }}</p>
		</template>
		<template #content>
			<div class="p-4">
				<div class="grid instance-file-roots-grid w-max gap-4">
					<div>
						<p class="font-main font-bold text-teal-5">Path Nickname</p>
					</div>
					<div>
						<p class="font-main font-bold text-teal-5">Path Value</p>
					</div>
					<div>
						<p class="font-main font-bold text-teal-5">Is Worlds Folder</p>
					</div>
					<div>
						<p class="font-main font-bold text-teal-5">Delete Path</p>
					</div>
					<template v-for="(entry, i) in updatedPaths">
						<div class="">
							<ValueInput placeholder="Path nickname" v-model="entry[0]" />
						</div>
						<div class="">
							<ValueInput placeholder="Path value" v-model="entry[1]" class="w-100"/>
						</div>
						<div class="flex justify-center items-center">
							<Checkbox class="h-5 w-5" :value="updatedWorldPaths.has(entry[1])" @input="toggleWorldPath(entry[1])" />
						</div>
						<div class="flex justify-center items-center cursor-pointer">
							<Icon icon="xmark" size="5" color="text-red-4" :title="`Delete path '${entry[1]}'`" @click="deletePath(i)" />
						</div>
					</template>
				</div>

				<div class="flex items-center5 mt-2 cursor-pointer bg-gray-5 hover:bg-gray-4 rounded w-max p-2" @click="addNewPath">
					<Icon icon="plus" size="4" color="text-white-0" />
					<p class="ml-2 font-main font-semibold text-sm text-white-0">ADD</p>
				</div>

				<div class="flex justify-end w-full">
					<FlexButton
						:variant="BTN_VARIANT.DANGER"
						@input="initDataHolders"
						class="mr-4"
					>
						<p class="font-main font-bold py-2 px-8 md:px-12">DISCARD</p>
					</FlexButton>
					<FlexButton
						:variant="BTN_VARIANT.PRIMARY"
						@input="savePaths"
					>
						<p class="font-main font-bold py-2 px-8 md:px-12">SAVE</p>
					</FlexButton>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { plural } from '../../../../util/format';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Checkbox from '../../../common/Checkbox.vue';


export default {
	mixins: [],
	components: {
		Checkbox,
	},
	props: {
		selectedInstanceData: {
			type: Object,
			required: true
		},
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			updatedPaths: null,
			updatedWorldPaths: null,
			saveLoading: false,
		}
	},
	computed: {
		fileLocationCount() {
			return Object.keys(this.instancePaths || {})?.length || 0;
		},
		instancePaths() {
			return this.serverStore.instanceFileRoots[this.selectedInstanceData.id];
		}
	},
	methods: {
		plural,
		initDataHolders() {
			this.updatedPaths = Object.entries(this.instancePaths || {});
			this.updatedWorldPaths = new Set(this.serverStore.instanceWorldPaths[this.selectedInstanceData.id]);
		},
		addNewPath() {
			this.updatedPaths.push(["", ""]);
		},
		deletePath(index) {
			this.updatedPaths.splice(index, 1);
		},
		toggleWorldPath(path) {
			if (this.updatedWorldPaths.has(path)) {
				this.updatedWorldPaths.delete(path);
			} else {
				this.updatedWorldPaths.add(path);
			}
		},
		async savePaths() {
			this.$validatePermissions(PERMISSIONS.instance.files.paths.write);

			if (this.saveLoading) return;
			this.saveLoading = true;

			try {
				const response = await post(`/instance/${this.selectedInstanceData.id}/paths`, PERMISSIONS.instance.files.paths.write, {
					paths: Object.fromEntries(this.updatedPaths),
					worldPaths: Array.from(this.updatedWorldPaths.values()),
				});
				this.$alert.success(`File paths saved`);
				this.fetchInstanceFiles(this.selectedInstanceData.id);
			} catch (e) {
				this.$alert.error("Error saving file paths");
				console.error(e);
			} finally {
				this.saveLoading = false;
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
	},
	watch: {
		instancePaths() {
			this.initDataHolders();
		}
	}
}
</script>

<style scoped>
.instance-file-roots-grid {
	grid-template-columns: auto auto auto auto;
}
</style>
