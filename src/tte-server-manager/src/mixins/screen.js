export const breakpoints = {
	sm: 640,
	md: 768,
	lg: 1024,
	xl: 1280,
	"2xl": 1536
};

export default {
	data() {
		return {
			screenSize: this.getScreenSize()
		}
	},
	computed: {
		isMobile() {
			return ['sm', 'xs'].includes(this.screenSize);
		},
		isTablet() {
			return ['sm', 'md', 'lg'].includes(this.screenSize);
		}
	},
	methods: {
		getScreenSize() {
			const width = window.innerWidth;
			if (width >= breakpoints["2xl"]) return "2xl";
			if (width >= breakpoints.xl) return "xl";
			if (width >= breakpoints.lg) return "lg";
			if (width >= breakpoints.md) return "md";
			if (width >= breakpoints.sm) return "sm";
			return "xs";
		},
		handleResize() {
			this.screenSize = this.getScreenSize();
		}
	},
	mounted() {
		window.addEventListener("resize", this.handleResize);
	},
	beforeDestroy() {
		window.removeEventListener("resize", this.handleResize);
	}
}