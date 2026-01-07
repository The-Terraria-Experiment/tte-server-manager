import { defineStore } from 'pinia';
import { get } from '../util/api';
import { PERMISSIONS } from '../util/permissionValues';

export const useServerStore = defineStore("serverstore", {
	state: () => ({
		instances: [],
		instanceData: {},
		servers: [
			{ id: "host-nfasi387y-world-sfbo8748", name: "world1", size: 702000 },
			{ id: "host-nfasi387y-world-be5ebyesb", name: "world2", size: 6010000 },
			{ id: "host-nfasi387y-world-svvsvs55v", name: "world3", size: 18000 },
		],
		instanceFiles: {},
		loading: {
			list: false,
			status: {},
			files: {}
		},
	}),
	getters: {
		instanceOptions: (state) => state.instances.map(i => ({ id: i.id, text: i.name })),
		getInstanceData: (state) => (instanceId) => {
			return state.instanceData[instanceId] || null;
		},
		isLoadingList: (state) => state.loading.list,
		isLoadingStatus: (state) => (instanceId) => state.loading.status[instanceId] || false,
	},
	actions: {
		async fetchInstanceList() {
			if (this.loading.list) return;
			this.loading.list = true;

			try {
				const instanceList = await get("/instances", PERMISSIONS.instance.list);
				this.instances = instanceList.instances || [];
				return this.instances;
			} catch (error) {
				console.error("Error fetching instance list:", error);
				throw error;
			} finally {
				this.loading.list = false;
			}
		},
		async fetchInstanceStatus(instanceId) {
			if (this.loading.status[instanceId]) return;
			this.loading.status[instanceId] = true;

			try {
				const instanceStatus = await get(`/instance/${instanceId}/status`, PERMISSIONS.instance.status.read);
				this.instanceData[instanceId] = instanceStatus.instance;
				return instanceStatus.instance;
			} catch (error) {
				console.error("Error fetching instance status:", error);
				throw error;
			} finally {
				this.loading.status[instanceId] = false;
			}
		},
		async fetchInstanceFiles(instanceId) {
			if (this.loading.files[instanceId]) return;
			this.loading.files[instanceId] = true;

			try {
				const data = await get(`/instance/${instanceId}/files`, PERMISSIONS.instance.files.read);
				this.instanceFiles[instanceId] = data.files;
			} catch (error) {
				console.error("Error fetching instance status:", error);
				throw error;
			} finally {
				this.loading.files[instanceId] = false;
			}
		}
	}
});
