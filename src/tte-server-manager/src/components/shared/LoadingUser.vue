<template>
	<div v-if="true || loadingUser" :class="['bg-gray-3 rounded-xl overflow-hidden h-max w-full flex justify-center items-center p-4 mb-4 sm:mb-8 ghost-loader']">
		<Spinner class="h-5 w-5 text-white-0" />
		<p class="font-main font-bold text-white-0 ml-2">Loading user data...</p>
	</div>
</template>

<script>
import Spinner from '../common/Spinner.vue';


export default {
	mixins: [],
	components: {
		Spinner,
	},
	props: {
		
	},
	data() {
		return {
			
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
