<template>
	<div 
		:class="['cursor-pointer rounded-lg flex items-center', btnStyle]" 
		@click="$emit('input')"
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
			validator: (val) => [BTN_VARIANT.PRIMARY, BTN_VARIANT.DANGER].includes(val)
		}
	},
	data() {

	},
	computed: {
		btnStyle() {
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
</style>