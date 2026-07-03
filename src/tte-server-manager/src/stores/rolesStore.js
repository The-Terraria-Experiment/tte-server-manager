import { defineStore } from "pinia";
import { get } from "../util/api";
import { PERMISSIONS } from "../util/permissionValues";

export const useRolesStore = defineStore("rolesstore", {
	state: () => ({
		roles: [],
		loading: false,
	}),
	getters: {

	},
	actions: {
		async fetchRoles() {
			if (this.loading) return;
			this.loading = true;

			try {
				const response = await get("/system/roles", PERMISSIONS.users.permissions.read);
				this.roles = response.entries || [];
			} catch (error) {
				console.error(error);
				throw new Error("Failed to fetch roles");
			} finally {
				this.loading = false;
			}
		}
	}
});
