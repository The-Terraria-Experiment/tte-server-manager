<template>
	<div class="flex flex-col sm:grid sm:grid-cols-2 2xl:grid-cols-4 mt-6 gap-2">
		<ServerState />
		<Players />
		<CommonServerInfo />
		<AutoShutoff />
	</div>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import ServerState from './basic/ServerState.vue';
import Players from './basic/Players.vue';
import CommonServerInfo from './basic/CommonServerInfo.vue';
import AutoShutoff from './basic/AutoShutoff.vue';

export default {
	mixins: [],
	components: {
		ServerState,
		Players,
		CommonServerInfo,
		AutoShutoff,
	},
	emits: [],
	props: {
		
	},
	data() {
		return {
			BTN_VARIANT,
			PERMISSIONS,
			serverStore: useServerStore(),
		}
	},
	computed: {
		selectedServerData() {
			return this.serverStore.selectedServerData;
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		}
	},
	methods: {

	},
}
</script>

<style scoped>

</style>
