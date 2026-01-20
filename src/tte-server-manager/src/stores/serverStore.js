import { defineStore } from 'pinia';
import { get } from '../util/api';
import { PERMISSIONS } from '../util/permissionValues';

export const useServerStore = defineStore("serverstore", {
	state: () => ({
		selected: {
			instance: null,
			server: null,
		},
		instances: [],
		instanceData: {},
		instanceFiles: {},
		instanceFileRoots: {},
		instanceWorldPaths: {},
		serverStatusData: {},
		serverConfigs: {},
		loading: {
			list: false,
			status: {},
			files: {},
			serverStatus: {},
			config: {},
		},
	}),
	getters: {
		instanceOptions: (state) => state.instances.map(i => ({ id: i.id, text: i.name })),
		getInstanceData: (state) => (instanceId) => {
			return state.instanceData[instanceId] || null;
		},
		isLoadingList: (state) => state.loading.list,
		isLoadingStatus: (state) => (instanceId) => state.loading.status[instanceId] || false,
		somethingIsLoading: (state) => {
			for (const cat of Object.values(state.loading)) {
				if (typeof cat !== "object") continue;
				for (const inst of Object.values(cat)) {
					if (inst) return inst;
				}
			}
			return state.loading.list || false;
		}
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
				this.instanceFileRoots[instanceId] = data.pathRoots;
				this.instanceWorldPaths[instanceId] = data.worldPaths;
			} catch (error) {
				console.error("Error fetching instance status:", error);
				throw error;
			} finally {
				this.loading.files[instanceId] = false;
			}
		},
		async fetchServerStatus(instanceId) {
			if (this.loading.serverStatus[instanceId]) return;
			this.loading.serverStatus[instanceId] = true;

			try {
				const data = await get(`/server/${instanceId}/status`, PERMISSIONS.server.status.read);
				this.serverStatusData[instanceId] = data.server;
			} catch (error) {
				console.error("Error fetching server status:", error);
				throw error;
			} finally {
				this.loading.serverStatus[instanceId] = false;
			}
		},
		async fetchServerConfig(instanceId) {
			if (this.loading.config[instanceId]) return;
			this.loading.config[instanceId] = true;

			try {
				const data = await get(`/server/${instanceId}/config`, PERMISSIONS.server.config.read);
				this.serverConfigs[instanceId] = {
					config: data.file,
					isDefaultConfig: data.isDefaultConfig
				};
			} catch (error) {
				console.error("Error fetching server config:", error);
				throw error;
			} finally {
				this.loading.config[instanceId] = false;
			}
		}
	}
});
