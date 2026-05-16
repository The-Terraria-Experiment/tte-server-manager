<template>
	<div>
		<StatusTile
			:class="['mt-4 sm:mt-8']"
			collapsible
			:perm-required="PERMISSIONS.server.config.read"
			:loading="loadingSaveConfig"
		>
			<template #header>
				<Icon icon="gear" color="text-gray-6" size="5" />
				<p class="text-gray-6 ml-2 text-lg">Other Configs</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">Some config</p>
			</template>
			<template #content>
				<div class="flex p-4 gap-2">
					<div class="bg-gray-1 rounded-md p-3 w-full">
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
					</div>
				</div>
			</template>
		</StatusTile>

		<FileBrowser 
			:open="pickerOpen" 
			:root="searchRoot ?? null"
			@picked=""
			@close="pickerOpen = false"
		/>
	</div>
</template>

<script>
import Dropdown from '@/components/common/Dropdown.vue';
import FileBrowser from '@/components/common/FileBrowser.vue';
import FlexButton from '@/components/common/FlexButton.vue';
import { useServerStore } from '@/stores/serverStore';
import { post } from '@/util/api';
import { BTN_VARIANT } from '@/util/constants';
import { PERMISSIONS } from '@/util/permissionValues';


export default {
	mixins: [],
	components: {
		Dropdown,
		FileBrowser,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			loadingSaveConfig: false,
			searchRoot: null,
			pickerOpen: false,
		}
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		fileRootOptions() {
			const allPathRoots = this.serverStore.instanceFileRoots[this.selectedInstance] ?? [];
			const allowedPathRoots = Object.keys(allPathRoots).filter(pname => this.$checkResourceAccess(`filepath::${this.selectedInstance}::${pname}`));
			return allowedPathRoots.map(r => ({ id: r, text: r }));
		},
	},
	methods: {
		async openPicker() {
			this.pickerOpen = true;
			
		},
		async getTree() {
			
		}
	},
	mounted() {
		this.getTree();
	}
}
</script>

<style scoped>

</style>
