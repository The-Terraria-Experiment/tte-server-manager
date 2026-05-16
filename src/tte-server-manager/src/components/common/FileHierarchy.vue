<template>
	<div>
		<template v-for="(entry, key) in levelFolders">
			<div class="ml-6">
				<div class="flex items-center mt-1 reveal-delete-icon">
					<Icon icon="folder" size="4" color="text-white-0" />
					<p :class="['font-mono ml-2 text-white-0']">{{ key }}</p>
					<Icon
						v-if="editable"
						icon="xmark" 
						size="4" 
						color="text-red-5" 
						class="opacity-0 cursor-pointer ml-2" 
						title="Delete folder and sub-items" 
						@click="emitDeleteClicked({ path: this.__path.concat(key), isFolder: true })"
					/>
				</div>
				
				<FileHierarchy 
					:editable="editable"
					:__isRoot="false"
					:files="[]"
					:__path="__path.concat(key)"
					:__structure="builtStructure || __structure"
					@deleteClicked="emitDeleteClicked"
					@addClicked="emitAddClicked"
					@picked="emitPicked"
				/>
			</div>
		</template>
		<template v-for="file in levelFiles">
			<div class="ml-6 flex items-center mt-1 reveal-delete-icon">
				<Icon icon="file-solid" size="4" color="text-white-0" />
				<p :class="['font-mono ml-2 text-white-0', {'cursor-pointer hover:text-white-1': !editable}]" @click="emitPicked(this.__path)">{{ file }}</p>
				<Icon 
					v-if="editable"
					icon="xmark" 
					size="4" 
					color="text-red-5" 
					class="opacity-0 cursor-pointer ml-2" 
					title="Delete file" 
					@click="emitDeleteClicked({ path: this.__path.concat(file), isFolder: false })"
				/>
			</div>
		</template>
		<div v-if="editable" class="flex items-center ml-5 mt-1 cursor-pointer bg-gray-4 hover:bg-gray-3 rounded w-max p-1" @click="emitAddClicked(this.__path)">
			<Icon icon="plus" size="4" color="text-white-0" />
			<p class="ml-2 font-main font-semibold text-sm text-white-0">ADD</p>
		</div>
	</div>
</template>

<script>
import Icon from './Icon.vue';


export default {
	name: "FileHierarchy",
	mixins: [],
	components: {
		Icon,
	},
	props: {
		files: {
			type: Array,
			required: true
		},
		editable: {
			type: Boolean,
			default: true
		},
		__isRoot: {
			type: Boolean,
			default: true
		},
		__path: {
			type: Array,
			default: () => []
		},
		__structure: {
			type: Object,
			default: () => ({})
		}
	},
	data() {
		return {
			builtStructure: null
		}
	},
	computed: {
		structureAtLevel() {
			return this.getStructureAtPath(this.__path);
		},
		levelFolders() {
			return Object.fromEntries(Object.entries(this.structureAtLevel)
				.filter(([key, entry]) => typeof entry === "object"));
		},
		levelFiles() {
			return Object.values(this.structureAtLevel)
				.filter(k => typeof k === "string");
		}
	},
	methods: {
		buildFileStructure() {
			const structure = {};

			const buildPath = (obj, path) => {
				path.forEach(key => {
					if (!Object.hasOwn(obj, key)) {
						obj[key] = {};
					}
					obj = obj[key];
				});
				return obj;
			};

			this.files.forEach(filepath => {
				const path = filepath.split("/");
				const atPath = buildPath(structure, path.slice(0, -1));
				atPath[path[path.length - 1]] = path[path.length - 1];
			});

			this.builtStructure = structure;
		},
		getStructureAtPath(path) {
			let obj = this.builtStructure || this.__structure;
			path.forEach(key => {
				obj = obj[key];
			});
			return obj;
		},
		emitAddClicked(path = null) {
			this.$emit('addClicked', path);
		},
		emitDeleteClicked(data) {
			this.$emit('deleteClicked', data);
		},
		emitPicked(path) {
			this.$emit("picked", path);
		}
	},
	created() {
		if (this.__isRoot) {
			this.buildFileStructure();
		}
	},
	watch: {
		files() {
			if (this.__isRoot) {
				this.buildFileStructure();
			}
		}
	}
}
</script>

<style scoped>
.reveal-delete-icon:hover .custom-icon {
	@apply opacity-100;
}
</style>