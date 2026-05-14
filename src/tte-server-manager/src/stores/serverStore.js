import { defineStore } from 'pinia';
import { get } from '../util/api';
import { PERMISSIONS } from '../util/permissionValues';
import { INSTANCE_STATES, WORLD_STATES } from '../util/constants.js';

export const useServerStore = defineStore("serverstore", {
	state: () => ({
		selected: {
			instance: null,
			server: null,
		},
		instances: [],
		instanceStatusData: {},
		instanceFiles: {},
		instanceFileRoots: {},
		instanceWorldPaths: {},
		serverStatusData: {},
		worldStatusData: {}, // map of server IDs to WORLD_STATES enum
		serverConfigs: {},
		loading: {
			list: false,
			status: {},
			files: {},
			serverStatus: {},
			config: {},
			worldLaunch: {}
		},
	}),
	getters: {
		instanceOptions: (state) => state.instances.map(i => ({ id: i.id, text: i.name })),
		getInstanceData: (state) => (instanceId) => {
			return state.instanceStatusData[instanceId] || null;
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
		},
		selectedServerData: (state) => {
			const data = state.serverStatusData[state.selected.instance];
			return {
				state: Boolean(state.serverStatusData[state.selected.instance]?.status),
				worldStatus: state.worldStatusData[state.selected.instance] || WORLD_STATES.UNKNOWN,
				status: data?.status, 					// string, http code
				name: data?.name, 						// string, usually empty
				serverversion: data?.serverversion,		// string, 4 part semantic version num, prefixed with 'v'
				tshockversion: data?.tshockversion,		// string, 4 part semantic version num
				port: data?.port,						// number
				playercount: data?.playercount,			// number
				maxplayers: data?.maxplayers,			// number
				world: data?.world,						// string, world name
				uptime: data?.uptime,					// string, "0.00:00:00"
				serverpassword: data?.serverpassword,	// boolean, true if password is set
				players: data?.players,					// array, player data
				rules: data?.rules						// object, map of rules to usually bools, but some nums/strings
			}
		},
		selectedInstanceData: (state) => {
			return {
				...state.instanceStatusData[state.selectedInstanceID],
				online: state.instanceStatusData[state.selectedInstanceID]?.state === "running"
			}
		},
		selectedInstanceID: (state) => state.selected.instance,
		selectedServerID: (state) => state.selected.server,
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
				this.instanceStatusData[instanceId] = instanceStatus.instance;
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
				this.instanceStatusData[instanceId] = data.instance;

				if (data.server.status === "200") {
					this.worldStatusData[instanceId] = WORLD_STATES.RUNNING;
				} else {
					this.worldStatusData[instanceId] = WORLD_STATES.OFFLINE;
				}
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
