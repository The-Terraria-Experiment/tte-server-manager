<template>
	<!-- <div class="flex flex-col sm:grid sm:grid-cols-2 gap-2"> -->
		<TshockConfigFile 
			:selected-server-data="selectedServerData"
			:selected-instance="selectedInstance" 
		/>

		<ManageBans 
			v-if="selectedInstance && selectedServerData.state"
			:selected-server-data="selectedServerData"
			:selected-instance="selectedInstance" 
		/>
	<!-- </div> -->
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import ManageBans from './ManageBans.vue';
import TshockConfigFile from './TshockConfigFile.vue';


export default {
	mixins: [],
	components: {
		ManageBans,
		TshockConfigFile,
	},
	props: {
		
	},
	data() {
		return {
			serverStore: useServerStore(),
		}
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		selectedServerData() {
			return this.serverStore.selectedServerData;
		}
	},
	methods: {
		
	},
}
</script>

<style scoped>

</style>
