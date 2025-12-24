<template>
	<svg 
		xmlns="http://www.w3.org/2000/svg" 
		viewBox="0 0 500 500" 
		:class="[`h-${size} w-${size}`, color, rotation]"
	>
		<path fill="currentColor" d="M500,0C223.86,0,0,223.86,0,500V0h500Z" />
	</svg>
</template>

<script>
export default {
	props: {
		size: {
			type: String,
			default: "8"
		},
		color: {
			type: String,
			default: "text-gray-3"
		},
		facing: {
			type: String,
			validator: (v) => ['br', 'tr', 'tl', 'bl'].includes(v)
		}
	},
	computed: {
		rotation() {
			switch (this.facing) {
				case 'br':
					return 'rotate-0';
				case 'tr':
					return 'rotate-270';
				case 'tl':
					return 'rotate-180';
				case 'bl':
					return 'rotate-90';
			}
		}
	}
}
</script>