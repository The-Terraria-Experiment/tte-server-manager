<template>
	<div>
		<StickyHeader />
		<RouterView />
		<MobileNav v-if="isMobile" />
		<DesktopNav v-else />
	</div>
</template>

<script>
import HelloWorld from './components/HelloWorld.vue';
import DesktopNav from './components/shared/DesktopNav.vue';
import MobileNav from './components/shared/MobileNav.vue';
import StickyHeader from './components/shared/StickyHeader.vue';
import screen from './mixins/screen';

export default {
	mixins: [ screen ],
	components: {
		HelloWorld,
		DesktopNav,
		StickyHeader,
		MobileNav,
	}
}
</script>

<style scoped>

</style>