import { defineStore } from 'pinia'

export const useUserStore = defineStore("userstore", {
	state: () => ({

	}),
	getters: {
		isAuthenticated: (state) => true
	},
	actions: {

	}
});