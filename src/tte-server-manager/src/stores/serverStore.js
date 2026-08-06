import { defineStore } from 'pinia';
import { get } from '../util/api';
import { PERMISSIONS } from '../util/permissionValues';
import { INSTANCE_STATES, WORLD_STATES } from '../util/constants.js';
import { shutdownTaskId, useStatusStore } from './statusStore.js';
import { useAlertStore } from './alertStore.js';

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
		/**
		 * The instance's shutdown job as the backend reports it, or null if it has never been stopped
		 * through the job path. Present on both the instance and server status responses — see
		 * fetchServerStatus for why it has to be on both.
		 */
		shutdownState: (state) => (instanceId) => state.instanceStatusData[instanceId]?.shutdown || null,
		/**
		 * True only while a shutdown is genuinely still running. Everything that mutates this instance
		 * should be disabled on this: the box is being torn down underneath it, and the same check is
		 * enforced server-side (409 SHUTDOWN_IN_PROGRESS), so a control left enabled just produces an
		 * error the user can't act on. A finished or abandoned job reports false.
		 */
		isShuttingDown: (state) => (instanceId) => Boolean(state.instanceStatusData[instanceId]?.shutdown?.active),
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
				rules: data?.rules,						// object, map of rules to usually bools, but some nums/strings
				autoShutoff: data?.autoShutoff			// object: { scheduledShutdownAt : number|null, pauseUntilAt: number|null, sequenceStage: string }
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
		/**
		 * Records a shutdown we just requested and starts tracking it.
		 *
		 * Seeds the state from the queue response rather than waiting for the first poll, for two
		 * reasons: the tile reads "SHUTTING DOWN · Queued" the instant STOP is pressed instead of up
		 * to five seconds later, and — more importantly — the poller's stop condition is evaluated
		 * before its first tick, so a terminal row left behind by a *previous* shutdown would
		 * otherwise be what it read. A stale `failed` row would end the poll immediately and announce
		 * the old failure as if it were this one.
		 */
		markShutdownQueued(instanceId, jobID = null) {
			this.instanceStatusData[instanceId] = {
				...(this.instanceStatusData[instanceId] || {}),
				shutdown: {
					active: true,
					status: "queued",
					step: "queued",
					progress: 0,
					detail: "Shutdown queued",
					jobID,
					requestedBy: null,
					failureReason: null,
					updatedAt: new Date().toISOString(),
					abandoned: false,
					idleForMs: 0,
				},
			};

			this.trackShutdown(instanceId);
		},
		/**
		 * Polls an in-flight shutdown until the instance is actually down.
		 *
		 * Lives in the store rather than in the component that pressed STOP, because a shutdown now
		 * runs for minutes and the user is free to navigate away while it does — a component-owned
		 * poller would stop the moment they left the page, and the tile they came back to would show
		 * a stage frozen wherever it was when they navigated.
		 *
		 * Safe to call repeatedly: `startRepeatingTask` ignores a second start for a task already
		 * running, and the subscriber is deduped by a stable ID.
		 */
		trackShutdown(instanceId) {
			if (!instanceId) return;

			const statusStore = useStatusStore();
			const taskID = shutdownTaskId(instanceId);
			const handlerID = `server-store-shutdown-${instanceId}`;

			statusStore.subscribeToTask(taskID, () => {
				this.fetchInstanceStatus(instanceId);
			}, handlerID);

			statusStore.subscribeToTaskEnd(taskID, () => {
				this.reportShutdownOutcome(instanceId);
			}, `${handlerID}-end`);

			// 5s × 90 ≈ 7.5 min: past the worker's own ceiling plus the time EC2 takes to actually
			// power down, so hitting the cap means something is wrong rather than merely slow.
			statusStore.startRepeatingTask(taskID, () => {
				const data = this.instanceStatusData[instanceId];
				const shutdown = data?.shutdown;

				if (shutdown?.active) return false;
				// Nothing more is coming from the worker; don't sit and wait for a stop it never issued.
				if (shutdown?.status === "failed" || shutdown?.abandoned) return true;

				return data?.state === "stopped";
			}, 5000, 90);
		},
		/** Announces how a tracked shutdown ended, exactly once, when its poller stops. */
		reportShutdownOutcome(instanceId) {
			const alertStore = useAlertStore();
			const shutdown = this.instanceStatusData[instanceId]?.shutdown;

			if (shutdown?.status === "failed") {
				alertStore.push({ type: "error", message: shutdown.failureReason || "The instance shutdown failed" });
				return;
			}

			if (shutdown?.abandoned) {
				alertStore.push({ type: "error", message: "The shutdown stopped without finishing. Check the instance state before trying again." });
				return;
			}

			if (this.instanceStatusData[instanceId]?.state === "stopped") {
				alertStore.push({ type: "success", message: "Instance shut down" });
				return;
			}

			// Deliberately not reported as a failure: the poller gave up watching, which tells us
			// nothing about whether the shutdown itself succeeded.
			alertStore.push({ type: "warning", message: "The shutdown is taking longer than expected — check back in a few minutes" });
		},
		async fetchInstanceStatus(instanceId) {
			if (this.loading.status[instanceId]) return;
			this.loading.status[instanceId] = true;

			try {
				const instanceStatus = await get(`/instance/${instanceId}/status`, PERMISSIONS.instance.status.read);
				this.instanceStatusData[instanceId] = instanceStatus.instance;

				// The whole reattach story: any status fetch that finds a live shutdown starts tracking
				// it. That covers a page refresh mid-shutdown, arriving on the page after someone else
				// started one, and an auto-shutoff that nobody was watching when it fired.
				if (instanceStatus.instance?.shutdown?.active) {
					this.trackShutdown(instanceId);
				}

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
				const data = await get(`/instance/${instanceId}/files`, [PERMISSIONS.server.world.list, PERMISSIONS.instance.files.read]);
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
				this.serverStatusData[instanceId] = { ...data.server, autoShutoff: data.autoShutoff ?? {} };
				// This overwrites the whole instance entry, shutdown block included — which is why the
				// server status endpoint has to carry it too, and why tracking is re-checked here.
				this.instanceStatusData[instanceId] = data.instance;

				if (data.instance?.shutdown?.active) {
					this.trackShutdown(instanceId);
				}

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
