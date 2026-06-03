<template>
	<StatusTile 
		class="grow sm:mt-2 gradient-tile"
		collapsible
		:floatingExpand="!isMobile"
		:perm-required="PERMISSIONS.server.status.read"
	>
		<template #header>
			<Icon icon="circle-info" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Auto-Shutoff</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">Auto-Shutoff</p>
		</template>
		<template #content>
			
		</template>
	</StatusTile>
</template>

<script>
import { PERMISSIONS } from '@/util/permissionValues';


export default {
	mixins: [],
	components: {
		
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
		}
	},
	computed: {
		
	},
	methods: {
		
	},
}
</script>

<style scoped>

</style>
