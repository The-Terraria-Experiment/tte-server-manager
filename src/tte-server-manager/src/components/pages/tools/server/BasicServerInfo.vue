<template>
	<div class="flex flex-col sm:grid sm:grid-cols-3">
		<StatusTile 
			:class="['grow mt-4 sm:mt-8 sm:mx-1 gradient-tile', selectedServerData.state ? 'gradient-tile-green' : 'gradient-tile-red']"
			:collapsible="selectedServerData.state"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="power" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Server Status</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">{{ selectedServerData.state ? 'RUNNING' : 'OFFLINE' }}</p>
					<Spinner v-if="false" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
			<template #content>
				<div v-if="selectedServerData.state">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.server.status.stop)"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.DANGER"
						@input=""
					>
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:collapsible="false"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="people-group" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Players Online</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">{{ selectedServerData.players?.length || 'Unknown' }}</p>
					<Spinner v-if="false" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
			<template #content>
				<!-- <div class="font-main font-semibold px-2 pb-2 text-teal-6 flex w-full flex-wrap">
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">havoc</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">exception</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">havoc</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">exception</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">havoc</div>
					<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1">exception</div>
				</div> -->
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="earth" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Active World</p>
			</template>
			<template #summary>
				<div class="flex items-center">
					<p class="text-2xl text-teal-4">{{ selectedServerData.world || 'Unknown' }}</p>
					<Spinner v-if="false" class="h-6 w-6 text-teal-3 ml-2"/>
				</div>
			</template>
		</StatusTile>
	</div>
</template>

<script>
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';


export default {
	mixins: [],
	components: {
		
	},
	props: {
		selectedServerData: {
			type: Object,
			required: true
		}
	},
	data() {
		return {
			BTN_VARIANT,
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
