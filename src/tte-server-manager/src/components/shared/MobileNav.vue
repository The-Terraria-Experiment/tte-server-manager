<template>
	<div class="bg-gray-3 fixed bottom-0 h-12 w-full rounded-t-2xl flex justify-around px-4 font-main font-semibold text-cream text-xs">
		<RouterLink to="/overview">
			<FlexButton class="flex-col">
				<div></div>
				<div>OVERVIEW</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/instance">
			<FlexButton class="flex-col">
				<div></div>
				<div>INSTANCE</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/server">
			<FlexButton class="flex-col">
				<div></div>
				<div>SERVER</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/users">
			<FlexButton class="flex-col">
				<div></div>
				<div>USERS</div>
			</FlexButton>
		</RouterLink>
	</div>
</template>

<script>
import FlexButton from '../common/FlexButton.vue';

export default {
	components: {
		FlexButton,
	}
}
</script>