<template>
	<div>
		<StickyHeader />

		<div v-if="isMobile">
			<div class="p-4">
				<RouterView />
			</div>
			<MobileNav />
		</div>
		<div v-else class="flex w-full h-max">
			<DesktopNav />
			<div class="ml-22 p-8">
				<RouterView />	
			</div>
		</div>
	</div>
</template>

<script>
import DesktopNav from './components/shared/DesktopNav.vue';
import MobileNav from './components/shared/MobileNav.vue';
import StickyHeader from './components/shared/StickyHeader.vue';
import screen from './mixins/screen';

export default {
	mixins: [ screen ],
	components: {
		DesktopNav,
		StickyHeader,
		MobileNav,
	}
}
</script>

<style scoped>

</style>