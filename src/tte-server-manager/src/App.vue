<template>
	<div>
		<StickyHeader />
		<RouterView />
		<MobileNav v-if="isMobile" />
		<DesktopNav v-else />
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