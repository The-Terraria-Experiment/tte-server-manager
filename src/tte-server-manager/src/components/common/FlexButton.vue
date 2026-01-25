<template>
	<div 
		:class="['cursor-pointer rounded-lg flex items-center gradientbg select-none', btnStyle]" 
		@click="input"
	>
		<div v-if="variant === BTN_VARIANT.SECONDARY">
			<div class="flex items-center">
				<Spinner v-if="loading" class="h-4 w-4 text-teal-3" thickness="4" />
				<Icon v-else :icon="leftIcon" color="text-teal-3" :size="leftIconSize" />
				<p class="text-teal-3 ml-2 font-main font-bold flex">
					<slot></slot>
				</p>
			</div>
		</div>
		<slot v-else></slot>
	</div>
</template>

<script>
import { BTN_VARIANT } from '../../util/constants';

export default {
	props: {
		variant: {
			type: String,
			default: BTN_VARIANT.SUBTLE,
			validator: (val) => Object.values(BTN_VARIANT).includes(val)
		},
		disabled: {
			type: Boolean,
			default: false
		},
		loading: {
			type: Boolean,
			default: false
		},
		leftIcon: {
			type: String,
			default: ""
		},
		leftIconSize: {
			type: String,
			default: "4"
		}
	},
	data() {
		return {
			BTN_VARIANT,
		}
	},
	computed: {
		btnStyle() {
			if (this.disabled) {
				return 'btn-disabled-style';
			}

			switch (this.variant) {
				case BTN_VARIANT.PRIMARY:
					return 'btn-primary-style';
				case BTN_VARIANT.SECONDARY:
					return 'bg-gray-4 hover:bg-gray-2 w-max pl-4 pr-6 py-2';
				case BTN_VARIANT.DANGER:
					return 'btn-danger-style';
				case BTN_VARIANT.SUBTLE:
					return '';
			}
		}
	},
	methods: {
		input() {
			if (!this.disabled) this.$emit('input');
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";

.btn-primary-style {
	@apply text-cream font-main font-bold w-max bg-linear-to-r from-teal-4 to-teal-1;
}

.btn-danger-style {
	@apply text-cream font-main font-bold w-max bg-linear-to-r from-red-5 to-red-1;
}

.btn-disabled-style {
	@apply bg-transparent;
}

.gradientbg {
	@apply to-50%;
	background-size: 200% 100%;
	background-position: 0% 0%;
	transition: background-position 200ms ease;
}

.gradientbg:hover {
	background-position: 50% 0%;
}
</style>