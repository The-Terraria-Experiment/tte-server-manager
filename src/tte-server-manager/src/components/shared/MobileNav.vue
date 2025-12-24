<template>
	<div class="bg-gray-3 fixed bottom-0 h-16 pb-3 w-full rounded-t-2xl flex justify-around px-4 font-main font-semibold text-cream text-xs">
		<RouterLink to="/overview">
			<FlexButton class="flex-col justify-end h-full">
				<Icon icon="gauge" size="5" color="text-cream"/>
				<div class="mt-1">OVERVIEW</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/instance">
			<FlexButton class="flex-col h-full justify-end">
				<Icon icon="server" size="6" color="text-cream"/>
				<div class="mt-1">INSTANCE</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/server">
			<FlexButton class="flex-col h-full justify-end">
				<Icon icon="gamepad" size="7" color="text-cream"/>
				<div class="mt-0.5">SERVER</div>
			</FlexButton>
		</RouterLink>
		<RouterLink to="/users">
			<FlexButton class="flex-col h-full justify-end">
				<Icon icon="user-lock" size="6" color="text-cream"/>
				<div class="mt-1">USERS</div>
			</FlexButton>
		</RouterLink>
	</div>
</template>

<script>
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';

export default {
	components: {
		FlexButton,
		Icon,
	}
}
</script>