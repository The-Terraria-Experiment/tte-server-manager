import { defineStore } from "pinia";
import { get } from "../util/api";
import { PERMISSIONS } from "../util/permissionValues";

/**
 * The instance registry: which EC2 instances exist and which environments (prod/stage) each serves.
 * Distinct from `serverStore.instances`, which is only the instances registered to the environment
 * this frontend is talking to — this one is unfiltered, so the editor can see and fix an instance
 * that belongs to the other environment.
 */
export const useInstanceRegistryStore = defineStore("instanceregistrystore", {
	state: () => ({
		entries: [],
		environments: [],
		loading: false,
	}),
	getters: {

	},
	actions: {
		async fetchRegistry() {
			if (this.loading) return;
			this.loading = true;

			try {
				const response = await get("/instances/registry", PERMISSIONS.system.instances.list.read);
				this.entries = response.instances || [];
				this.environments = response.environments || [];
			} catch (error) {
				console.error(error);
				throw new Error("Failed to fetch instance registry");
			} finally {
				this.loading = false;
			}
		}
	}
});
