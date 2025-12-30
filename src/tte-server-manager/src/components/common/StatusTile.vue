<template>
	<div class="bg-gray-3 rounded-xl overflow-hidden h-max">
		<div class="flex w-full items-stretch" @click="toggle">
			<div class="flex flex-col grow font-main font-bold">
				<div class="flex items-center px-4 pt-2 pb-4">
					<slot name="header"></slot>
				</div>
				<div class="px-4 pb-4">
					<slot name="summary"></slot>
				</div>
			</div>
			<div v-if="collapsible" class="cursor-pointer flex items-center px-2">
				<Icon 
					icon="caret-down" 
					color="text-teal-4" 
					:class="['transition-transform duration-200', { 'rotate-180': !collapsed }]"
				/>
			</div>
		</div>
		
		<Transition
			name="collapse"
			@before-enter="beforeEnter"
			@enter="enter"
			@after-enter="afterEnter"
			@before-leave="beforeLeave"
			@leave="leave"
			@after-leave="afterLeave"
		>
			<div v-show="!collapsed">
				<slot name="content"></slot>
			</div>
		</Transition>
	</div>
</template>

<script>
import Icon from "../common/Icon.vue";

export default {
	components: {
		Icon,
	},
	props: {
		collapsible: {
			type: Boolean,
			default: false
		},
		startOpen: {
			type: Boolean,
			default: false
		}
	},
	data() {
		return {
			collapsed: !this.startOpen
		}
	},
	methods: {
		toggle() {
			if (this.collapsible) {
				this.collapsed = !this.collapsed;
			}
		},
		beforeEnter(el) {
			el.style.height = '0px';
			el.style.overflow = 'hidden';
		},
		enter(el) {
			// Measure full height and animate to it
			const h = el.scrollHeight;
			el.style.height = h + 'px';
		},
		afterEnter(el) {
			// Allow content to grow/shrink naturally after animation
			el.style.height = 'auto';
			el.style.overflow = '';
		},
		beforeLeave(el) {
			// Set current height to enable transition back to 0
			el.style.height = el.scrollHeight + 'px';
			el.style.overflow = 'hidden';
		},
		leave(el) {
			// Force reflow and then collapse
			void el.offsetHeight;
			el.style.height = '0px';
		},
		afterLeave(el) {
			// Clean inline styles after collapse completes
			el.style.height = '';
			el.style.overflow = '';
		}
	}
}
</script>

<style scoped>
.collapse-enter-active,
.collapse-leave-active {
	transition: height 200ms ease;
}

</style>