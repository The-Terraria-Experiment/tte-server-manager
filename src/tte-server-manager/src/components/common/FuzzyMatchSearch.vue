<template>
	<ValueInput
		:placeholder="placeholder"
		v-model="filterValue"
	/>
</template>

<script>
import { similarity } from '../../util/fuzzyMatch.js';

export default {
	mixins: [],
	components: {
		
	},
	props: {
		placeholder: {
			type: String,
			default: "Filter..."
		},
		data: {
			type: Array,
			required: true,
		},
		comparisonKey: {
			type: String,
			required: true
		},
		sortResults: {
			type: Boolean,
			default: false
		},
		filterThreshold: {
			type: Number,
			default: 0.35
		}
	},
	data() {
		return {
			filterValue: "",
		}
	},
	computed: {
		filteredData() {
			const query = this.filterValue.trim().toLowerCase();

			if (!query) {
				return this.data;
			}

			const scored = this.data
				.map(d => {
					const score = similarity(query, d[this.comparisonKey].toLocaleLowerCase());
					return { data: d, score };
				})
				.filter(d => d.score >= this.filterThreshold);

			if (this.sortResults) {
				scored.sort((a, b) => b.score - a.score);
			}

			return scored.map(d => d.data);
		}
	},
	methods: {
		
	},
	watch: {
		data() {
			this.$emit("update", this.filteredData);
		},
		filterValue() {
			this.$emit("update", this.filteredData);
		}
	}
}
</script>

<style scoped>

</style>
