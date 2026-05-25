<template>
	<Teleport to="body">
		<div 
			:class="['fixed left-0 top-0 right-0 bottom-0 overlay-backdrop', zLayers[layer], { 'overlay-open': open, 'overlay-closed': !open }]" 
			@click="xClicked"
		/>
		
		<Transition
			enter-active-class="popup-enter"
			leave-active-class="popup-leave"
		>
			<div 
				v-if="open"
				:class="[
					'fixed left-0 top-0 right-0 bottom-0 m-auto flex flex-col overflow-hidden shadow-gray-0 shadow-lg rounded-lg bg-gray-3',
					zLayers[Number(layer) + 1],
					bodyClass
				]"
			>
				<div class="w-full h-12 flex justify-between items-center px-4 bg-gray-4">
					<p class="font-main font-bold text-white-0 px-2">{{ headerText }}</p>
					<div v-if="!xDisabled" class="cursor-pointer p-2" @click="xClicked">
						<Icon icon="xmark" color="text-white-0" size="5" />
					</div>
				</div>

				<div class="flex-1 overflow-y-auto">
					<slot></slot>
				</div>

				<div 
					v-if="buttons.length"
					class="w-full bg-gray-4 py-2 flex justify-end px-4"
				>
					<template v-for="button in buttons">
						<FlexButton
							v-if="button"
							:variant="button.variant"
							@input="doClick(button)"
							class="ml-4 text-sm sm:text-md"
						>
							<p class="font-main font-bold py-2 px-4 md:px-10">{{ button.text }}</p>
						</FlexButton>
					</template>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<script>
import FlexButton from './FlexButton.vue';
import Icon from './Icon.vue';

export default {
	components: {
		Icon,
		FlexButton,
	},
	props: {
		layer: {
			type: String,
			default: "0",
			validator: (val) => parseInt(val) <= 2
		},
		bodyClass: {
			type: String,
			default: "w-11/12 sm:w-1/2 h-1/2"
		},
		headerText: {
			type: String,
			default: ""
		},
		xDisabled: {
			type: Boolean,
			default: false
		},
		open: {
			type: Boolean,
			default: false
		},
		buttons: {
			type: Array,
			default: []
		},
		originalState: {
			default: null
		},
		setState: {
			type: Function,
			default: () => {}
		},
		getOriginalStateUntil: {
			type: Boolean,
			default: false
		}
	},
	data() {
		return {
			zLayers: ["z-20", "z-30", "z-40", "z-50"],
			preModifiedState: null
		}
	},
	computed: {

	},
	emits: ['xClicked'],
	methods: {
		xClicked() {
			if (this.xDisabled) return;
			this.setState?.(this.preModifiedState);
			this.$emit('xClicked');
		},
		doClick(btnData) {
			if (btnData.resetState) {
				this.setState(this.preModifiedState);
			}
			btnData.onClick();
		},
		setPreModifiedState() {
			this.preModifiedState = structuredClone(this.originalState);
		}
	},
	mounted() {
		this.setPreModifiedState();
	},
	watch: {
		originalState(value) {
			if (!this.getOriginalStateUntil) {
				this.setPreModifiedState();
			}
		},
		open(value) {
			this.setPreModifiedState();
		}
	}
}
</script>

<style scoped>
/* Backdrop is now persistent; we fade via CSS transitions instead of mount/unmount */
.overlay-backdrop {
	background-color: var(--tw-color-gray-0, rgba(0,0,0,0.35));
	/* start invisible and no blur */
	opacity: 0;
	backdrop-filter: blur(0px);
	transition: opacity 0.15s ease-out, backdrop-filter 0.15s ease-out;
	will-change: opacity, backdrop-filter;
	pointer-events: none; /* avoid clicks when closed */
}
.overlay-open {
	opacity: 1;
	backdrop-filter: blur(3px); /* match backdrop-blur-xs */
	pointer-events: auto;
}
.overlay-closed {
	opacity: 0;
	backdrop-filter: blur(0px);
	pointer-events: none;
}

.popup-enter {
	animation: slideUpFade 0.15s ease-out;
}

.popup-leave {
	animation: slideUpFade 0.12s ease-in reverse;
}

/* Removed nested blur overlay transition; handled by persistent overlay-backdrop */

@keyframes fadeIn {
	from {
		opacity: 0;
	}
	to {
		opacity: 1;
	}
}

@keyframes slideUpFade {
	from {
		opacity: 0;
		transform: translateY(20px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

/* Popup motion remains the same */
</style>