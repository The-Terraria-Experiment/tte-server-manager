import { defineStore } from "pinia";
import { get } from "../util/api";
import { PERMISSIONS } from "../util/permissionValues";

export const usePatreonTierMapStore = defineStore("patreontiermapstore", {
	state: () => ({
		entries: [],
		loading: false,
	}),
	getters: {

	},
	actions: {
		async fetchTierMap() {
			if (this.loading) return;
			this.loading = true;

			try {
				const response = await get("/system/patreon/tiermap", PERMISSIONS.users.permissions.read);
				this.entries = response.entries || [];
			} catch (error) {
				console.error(error);
				throw new Error("Failed to fetch Patreon tier map");
			} finally {
				this.loading = false;
			}
		}
	}
});
