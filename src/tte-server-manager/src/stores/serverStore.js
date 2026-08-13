import { defineStore } from 'pinia';
import { get, post, put } from '../util/api';
import { PERMISSIONS } from '../util/permissionValues';
import { INSTANCE_STATES, WORLD_STATES } from '../util/constants.js';
import { shutdownTaskId, useStatusStore } from './statusStore.js';
import { useAlertStore } from './alertStore.js';

/** Inventory cache key. Nicknames are unique per server but not across them. */
const inventoryKey = (instanceId, playerName) => `${instanceId}::${playerName}`;

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
		/**
		 * In-flight worldgen job per instance, as the backend reports it.
		 *
		 * Lives in the store rather than in CreateWorld.vue because the guard it drives is
		 * cross-component and cross-operator: SelectWorld's launch button has to respect a creation
		 * someone else started, and a component-local copy dies on unmount. Same reasoning as the
		 * `shutdown` block on instanceStatusData driving isShuttingDown everywhere.
		 */
		worldCreateStatus: {},
		serverConfigs: {},
		playerInventories: {}, // keyed `${instanceId}::${playerName}` — see inventoryKey
		/** Per-instance item rule list, as `GET /server/{id}/items/rules` reports it. */
		itemRules: {},
		/**
		 * Per-instance map of player name to their latest rule violation.
		 *
		 * Written only by fetchViolations. The socket event that triggers that fetch carries no
		 * violation data of its own — it says the set changed, and this is where the actual answer is
		 * read from, behind the same permission check every other read goes through.
		 */
		violations: {},
		violationsMeta: {}, // per instance: { lastScanAt, lastScanStatus }
		loading: {
			list: false,
			status: {},
			files: {},
			serverStatus: {},
			config: {},
			worldLaunch: {},
			inventory: {},
			itemRules: {},
			violations: {},
			itemScan: {},
			violationDismiss: {}
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
		 * Whether a server-status fetch is already in flight for this instance.
		 *
		 * Exists for realtimeStore. `fetchServerStatus` DROPS a concurrent call rather than queueing it,
		 * and returns undefined whether it ran or was dropped — so a socket-driven refetch has no way to
		 * tell "done" from "silently discarded". Without checking this first and re-arming, a burst of
		 * events landing during an unrelated fetch would vanish and leave the UI stale, which is exactly
		 * the failure the socket exists to fix.
		 */
		isLoadingServerStatus: (state) => (instanceId) => state.loading.serverStatus[instanceId] || false,
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
		getWorldCreateStatus: (state) => (instanceId) => state.worldCreateStatus[instanceId] || null,
		/**
		 * True while a world is genuinely being created on this instance, by anyone.
		 *
		 * Mirrors the backend's `isWorldgenBlocking`: terminal and abandoned jobs report false, because
		 * those are exactly the rows `queueCreateWorld` will happily overwrite. Anything that would start
		 * a world creation or a launch should be disabled on this — the server returns 409 CONFLICT
		 * regardless, so a control left enabled just lets someone fill in the whole form first.
		 */
		isCreatingWorld: (state) => (instanceId) => {
			const job = state.worldCreateStatus[instanceId];
			if (!job || job.found === false) return false;
			if (job.abandoned) return false;
			return !["completed", "failed"].includes(job.status);
		},
		/** Display name of whoever started the in-flight creation, for the "started by X" label. */
		worldCreateRequestedBy: (state) => (instanceId) => state.worldCreateStatus[instanceId]?.requestedBy || null,
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
		/**
		 * A player's last-fetched inventory report, or null. Keyed per instance *and* player because
		 * the same nickname can be on two servers, and the popup is opened per player.
		 */
		getPlayerInventory: (state) => (instanceId, playerName) => state.playerInventories[inventoryKey(instanceId, playerName)] || null,
		isLoadingInventory: (state) => (instanceId, playerName) => state.loading.inventory[inventoryKey(instanceId, playerName)] || false,
		/** The instance's item rule list, or null before it has been fetched. */
		getItemRules: (state) => (instanceId) => state.itemRules[instanceId] || null,
		isLoadingItemRules: (state) => (instanceId) => state.loading.itemRules[instanceId] || false,
		isScanningItems: (state) => (instanceId) => state.loading.itemScan[instanceId] || false,
		/** Map of player name to violation. Empty object, never null, so callers can index it freely. */
		getViolations: (state) => (instanceId) => state.violations[instanceId] || {},
		/** One player's latest violation, or null. Keyed on the same nickname the roster carries. */
		getPlayerViolation: (state) => (instanceId, playerName) => state.violations[instanceId]?.[playerName] || null,
		getViolationsMeta: (state) => (instanceId) => state.violationsMeta[instanceId] || null,
		/**
		 * Whether a violations fetch is in flight. Same purpose as isLoadingServerStatus: the socket
		 * handler checks this before flushing and re-arms if it's set, because the fetch below drops a
		 * concurrent call rather than queueing it.
		 */
		isLoadingViolations: (state) => (instanceId) => state.loading.violations[instanceId] || false,
		isDismissingViolations: (state) => (instanceId) => state.loading.violationDismiss[instanceId] || false,
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
		/**
		 * Reads the current worldgen job for an instance.
		 *
		 * Errors are deliberately NOT swallowed — CreateWorld.vue's poller distinguishes a lost
		 * connection from a finished job and alerts differently, so it needs the throw. Returns null
		 * when there is no job row, which is the same signal (`found: false`) the endpoint sends.
		 */
		async fetchWorldCreateStatus(instanceId) {
			const status = await get(`/server/${instanceId}/world/create/alljobs/status`, PERMISSIONS.server.world.create);

			if (!status || status.found === false) {
				delete this.worldCreateStatus[instanceId];
				return null;
			}

			this.worldCreateStatus[instanceId] = status;
			return status;
		},
		setWorldCreateStatus(instanceId, status) {
			this.worldCreateStatus[instanceId] = status;
		},
		clearWorldCreateStatus(instanceId) {
			delete this.worldCreateStatus[instanceId];
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
				this.evictDepartedInventories(instanceId, data.server?.players);

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
		/**
		 * Refetches only the roster, via `GET /server/{id}/status?fields=players`.
		 *
		 * This is what a `server.players` socket event triggers, so it runs on every join and leave for
		 * every open browser — the one read whose frequency is set by how busy the game is. The slim
		 * response skips three Dynamo reads and asks TShock for players without rules.
		 *
		 * It **merges** into the existing entry instead of replacing it, which is the whole reason the
		 * slim response omits `instance`: `fetchServerStatus` assigns `instanceStatusData[id]`
		 * wholesale, and a partial response going through that path would wipe the shutdown block out
		 * from under `trackShutdown` and every guard that reads it. Nothing here touches
		 * `instanceStatusData` at all.
		 *
		 * Falls back to a full fetch when there is nothing to merge into, so the tile can't end up
		 * showing a player count beside a blank server name and version.
		 */
		async fetchPlayerList(instanceId) {
			if (!this.serverStatusData[instanceId]) {
				return this.fetchServerStatus(instanceId);
			}

			// Shares the full fetch's flag so the two can't interleave writes, and so realtimeStore's
			// existing busy check and re-arm cover this path without knowing it exists.
			if (this.loading.serverStatus[instanceId]) return;
			this.loading.serverStatus[instanceId] = true;

			try {
				const data = await get(`/server/${instanceId}/status?fields=players`, PERMISSIONS.server.status.read);

				this.serverStatusData[instanceId] = {
					...this.serverStatusData[instanceId],
					status: data.server.status,
					playercount: data.server.playercount,
					players: data.server.players,
				};

				if (data.server.status === "200") {
					this.worldStatusData[instanceId] = WORLD_STATES.RUNNING;
				} else {
					this.worldStatusData[instanceId] = WORLD_STATES.OFFLINE;
				}

				this.evictDepartedInventories(instanceId, data.server?.players);
			} catch (error) {
				console.error("Error fetching player list:", error);
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
		},
		/**
		 * Reads a player's full inventory from the InventoryMonitor plugin via server-manager.
		 *
		 * Always refetches rather than serving the cached copy: an inventory is live state a player
		 * changes second to second, and this is used to check for cheated items — a stale answer is
		 * worse than a slow one. The cache exists so the grid keeps rendering across a re-fetch, not
		 * to avoid the request.
		 */
		async fetchPlayerInventory(instanceId, playerName) {
			const key = inventoryKey(instanceId, playerName);
			if (this.loading.inventory[key]) return;
			this.loading.inventory[key] = true;

			try {
				const data = await get(
					`/server/${instanceId}/players/${encodeURIComponent(playerName)}/inventory`,
					PERMISSIONS.server.player.inventory.read
				);
				this.playerInventories[key] = data.inventory;
				return data.inventory;
			} catch (error) {
				console.error("Error fetching player inventory:", error);
				throw error;
			} finally {
				this.loading.inventory[key] = false;
			}
		},
		/**
		 * Drops cached inventories for players no longer on the roster.
		 *
		 * Called from fetchServerStatus because that is the only place the roster is written, so the
		 * eviction cannot drift from the thing it keys off. Nothing evicted this cache before, so a
		 * player who logged out weeks ago kept an entry for the life of the page.
		 *
		 * Skipped entirely when the roster is unknown: "the server reported nobody online" and "we have
		 * no roster information" both arrive as an absent `players`, and evicting on the second would
		 * throw away entries for players who are still on. PlayerInventory.vue retains its own copy of
		 * whatever it is displaying, so an eviction never blanks out an inventory someone is reading.
		 */
		/** Reads the instance's item rule list. */
		async fetchItemRules(instanceId) {
			if (this.loading.itemRules[instanceId]) return;
			this.loading.itemRules[instanceId] = true;

			try {
				const data = await get(`/server/${instanceId}/items/rules`, PERMISSIONS.server.player.inventory.rules.read);
				this.itemRules[instanceId] = { ...data.rules, configured: data.configured };
				return this.itemRules[instanceId];
			} catch (error) {
				console.error("Error fetching item rules:", error);
				throw error;
			} finally {
				this.loading.itemRules[instanceId] = false;
			}
		},
		async saveItemRules(instanceId, rules) {
			const data = await put(`/server/${instanceId}/items/rules`, PERMISSIONS.server.player.inventory.rules.write, {
				enabled: rules.enabled,
				mode: rules.mode,
				groups: rules.groups,
				entries: rules.entries,
			});
			this.itemRules[instanceId] = { ...data.rules, configured: true };
			return this.itemRules[instanceId];
		},
		/**
		 * Reads the current violation set.
		 *
		 * `notify` is off by default on purpose. This runs from three places — opening the page, a
		 * socket event, and the reconnect refetch — and only the socket event means "something just
		 * happened". Announcing the reconnect's results would fire a notification for a violation that
		 * may be hours old, every time a laptop woke up.
		 *
		 * Returns the players newly flagged since the last fetch. The diff belongs here because this is
		 * the only place that holds both the old set and the new one.
		 */
		async fetchViolations(instanceId, { notify = false } = {}) {
			if (this.loading.violations[instanceId]) return [];
			this.loading.violations[instanceId] = true;

			const previous = this.violations[instanceId] || {};

			try {
				const data = await get(`/server/${instanceId}/items/violations`, PERMISSIONS.server.player.inventory.violations.read);
				const next = data.violations || {};

				// New to us if the player wasn't flagged before, or is flagged off a different snapshot —
				// the second case is a player who rejoined still carrying something they shouldn't.
				const fresh = Object.keys(next).filter(
					player => previous[player]?.snapshotId !== next[player]?.snapshotId
				);

				this.violations[instanceId] = next;
				this.violationsMeta[instanceId] = {
					lastScanAt: data.lastScanAt ?? null,
					lastScanStatus: data.lastScanStatus ?? null,
				};

				return notify ? fresh : [];
			} catch (error) {
				console.error("Error fetching item violations:", error);
				throw error;
			} finally {
				this.loading.violations[instanceId] = false;
			}
		},
		/**
		 * Asks for an out-of-band drain. The response only says the job was queued — the results arrive
		 * through the socket, or through the next fetch, exactly as they do for an event-driven scan.
		 */
		async requestItemScan(instanceId) {
			if (this.loading.itemScan[instanceId]) return;
			this.loading.itemScan[instanceId] = true;

			try {
				return await post(`/server/${instanceId}/items/scan`, PERMISSIONS.server.player.inventory.violations.read, {});
			} finally {
				this.loading.itemScan[instanceId] = false;
			}
		},
		/**
		 * Clears flags for players that have been dealt with.
		 *
		 * Applies the server's answer rather than the request: the response says which players were
		 * actually flagged when the write landed, so a name someone else already cleared drops out
		 * instead of this browser pretending it removed something. Removing them here rather than
		 * refetching keeps the tile responsive — the socket event this publishes updates every *other*
		 * browser, and its own refetch would only tell us what we already know.
		 *
		 * `players` omitted means "everything currently flagged", resolved server-side against the row
		 * so it can't wipe a violation raised between the click and the write.
		 */
		async dismissViolations(instanceId, players = null) {
			if (this.loading.violationDismiss[instanceId]) return [];
			this.loading.violationDismiss[instanceId] = true;

			try {
				const body = players ? { players } : { all: true };
				const data = await post(
					`/server/${instanceId}/items/violations/dismiss`,
					PERMISSIONS.server.player.inventory.violations.write,
					body
				);

				const dismissed = data?.dismissed || [];
				if (dismissed.length && this.violations[instanceId]) {
					const next = { ...this.violations[instanceId] };
					dismissed.forEach(player => delete next[player]);
					this.violations[instanceId] = next;
				}

				return dismissed;
			} catch (error) {
				console.error("Error dismissing item violations:", error);
				throw error;
			} finally {
				this.loading.violationDismiss[instanceId] = false;
			}
		},
		evictDepartedInventories(instanceId, players) {
			if (!Array.isArray(players)) return;

			const online = new Set(players.map(player => player.nickname));
			for (const key of Object.keys(this.playerInventories)) {
				const separator = key.indexOf("::");
				// Split on the first separator only — instance IDs never contain one, nicknames might.
				if (key.slice(0, separator) !== instanceId) continue;
				if (!online.has(key.slice(separator + 2))) {
					delete this.playerInventories[key];
				}
			}
		}
	}
});
