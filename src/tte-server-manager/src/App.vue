<template>
	<div>
		<RouterView />
		<DesktopNav />
	</div>
</template>

<script>
import HelloWorld from './components/HelloWorld.vue';
import DesktopNav from './components/shared/DesktopNav.vue';

export default {
	components: {
		HelloWorld,
		DesktopNav,
	}
}
</script>

<style scoped>

</style>