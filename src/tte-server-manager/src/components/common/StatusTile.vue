<template>
	<div 
		:class="[
			'bg-gray-3 rounded-xl h-max relative',
			{ 'not-allowed-tile': !validated },
			{ 'overflow-hidden': !floatingExpand && !collapsed }
		]"
		v-if="validated"
	>
		<div :class="[
			floatingExpand ? 'rounded-xl overflow-hidden h-max transition-200 transition-all relative' : 'contents',
			{ 'scale-x-[1.01] -translate-y-2 w-full shadow-2xl shadow-black': floatingExpand && !collapsed },
			{'bg-gray-3 z-20': !collapsed || transitioning}]"
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
				:name="floatingExpand ? 'floating' : 'collapse'"
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
		floatingExpand: {
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
			validated: true,
			transitioning: false,
		}
	},
	computed: {
		innerWrapStyle() {
			if (this.floatingExpand && !this.collapsed) {
				const rect = this.$el.getBoundingClientRect();
				this.$el.height = rect.height;
			}
		}
	},
	methods: {
		toggle() {
			if (this.transitioning) return;

			if (this.collapsible) {
				this.collapsed = !this.collapsed;
			}
		},
		collapse() {
			this.collapsed = true;
		},
		expand() {
			this.collapsed = false;
		},
		beforeEnter(el) {
			el.style.height = '0px';
			el.style.overflow = 'hidden';
			if (this.floatingExpand) {
				this.transitioning = true;
				const rect = this.$el.getBoundingClientRect();
				this.$el.style.height = rect.height + "px";
			}
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
			this.transitioning = false;
		},
		beforeLeave(el) {
			// Set current height to enable transition back to 0
			el.style.height = el.scrollHeight + 'px';
			el.style.overflow = 'hidden';
			if (this.floatingExpand) {
				this.transitioning = true;
			}
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
			this.transitioning = false;
			this.$el.style.height = "";
		}
	},
	created() {
		if (this.permRequired && !this.$checkPermissions(this.permRequired)) {
			this.validated = false;
		}
	},
	watch: {
		collapsible(value) {
			if (!value && !this.collapsed) {
				this.collapse();
			}
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

.floating-enter-active,
.floating-leave-active {
	transition: height 200ms ease;
}

.floating-shell-open {
	z-index: 30;
}

.floating-shell-closed {
	z-index: 20;
}

.not-allowed-tile {
	@apply bg-linear-to-b from-gray-3 to-red-0 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
}
</style>