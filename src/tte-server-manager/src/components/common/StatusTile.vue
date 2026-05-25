<template>
	<div 
		:class="['bg-gray-3 rounded-xl overflow-hidden h-max', { 'not-allowed-tile': !validated }]"
		v-if="validated"
	>
		<div :class="[{ 'flex w-full items-stretch': collapsible }]" @click="toggle">
			<div class="flex flex-col grow font-main font-bold">
				<div class="flex items-center px-4 pt-2 pb-2">
					<slot name="header"></slot>
					<Spinner v-if="!$slots.summary && loading" class="h-5 w-5 text-teal-3 ml-2"/>
				</div>
				<div class="px-4 pb-4" v-if="$slots.summary">
					<div class="flex items-center">
						<slot name="summary"></slot>
						<Spinner v-if="loading" class="h-6 w-6 text-teal-3 ml-2"/>
					</div>
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
			<div v-show="!collapsible || !collapsed">
				<slot name="content"></slot>
			</div>
		</Transition>
	</div>
	<div v-else-if="!validated && displayIfNotAllowed">
		<div class="flex w-full items-stretch">
			<div class="flex flex-col grow font-main font-bold">
				<div class="flex items-center px-4 pt-2 pb-4">
					<Icon icon="warning" color="text-white-0" size="4" />
					<p class="text-white-0 ml-2 text-lg">Insufficient Permissions</p>
				</div>
				<div class="px-4 pb-4">
					<p class="text-2xl text-red-5">TOOL(S) UNAVAILABLE</p>
				</div>
			</div>
		</div>
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
		},
		permRequired: {
			type: [String, Array, null],
			default: null
		},
		displayIfNotAllowed: {
			type: Boolean,
			default: false
		},
		loading: {
			type: Boolean,
			default: false
		}
	},
	data() {
		return {
			collapsed: !this.startOpen,
			validated: true
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
	},
	created() {
		if (this.permRequired && !this.$checkPermissions(this.permRequired)) {
			this.validated = false;
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";

.collapse-enter-active,
.collapse-leave-active {
	transition: height 200ms ease;
}

.not-allowed-tile {
	@apply bg-linear-to-b from-gray-3 to-red-0 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
}
</style>