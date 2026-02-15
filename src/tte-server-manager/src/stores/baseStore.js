import { defineStore } from "pinia";
import { get } from "../util/api";
import { PERMISSIONS } from "../util/permissionValues";

export const useBaseStore = defineStore("basestore", {
	state: () => ({
		siteEnabled: true,
		globalNotice: "",
		noticeDismissed: false,
	}),
	getters: {

	},
	actions: {
		async loadNotice() {
			try {
				const response = await get("/system/notice", PERMISSIONS.access);
				this.siteEnabled = response.enabled;
				this.globalNotice = response.message;
			} catch (error) {
				console.error(error);
				throw new Error("Failed to fetch global notices");
			}
		}
	}
});
