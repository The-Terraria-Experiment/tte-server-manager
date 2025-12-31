<template>
	<div 
		:class="['cursor-pointer rounded-lg flex items-center gradientbg select-none', btnStyle]" 
		@click="input"
	>
		<slot></slot>
	</div>
</template>

<script>
import { BTN_VARIANT } from '../../util/constants';

export default {
	props: {
		variant: {
			type: String,
			default: BTN_VARIANT.SUBTLE,
			validator: (val) => [BTN_VARIANT.PRIMARY, BTN_VARIANT.DANGER, BTN_VARIANT.SUBTLE].includes(val)
		},
		disabled: {
			type: Boolean,
			default: false
		}
	},
	data() {
		return {

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