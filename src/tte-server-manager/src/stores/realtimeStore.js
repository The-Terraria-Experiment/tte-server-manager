import { defineStore } from "pinia";
import { Hub } from "aws-amplify/utils";
import { post } from "../util/api";
import { PERMISSIONS } from "../util/permissionValues";
import { useUserStore } from "./userStore";
import { useServerStore } from "./serverStore";
import { TASK_IDS, useStatusStore } from "./statusStore";
import { KNOWN_REALTIME_EVENTS, REALTIME_EVENTS } from "../util/realtimeEvents";
import { notifyViolation } from "../util/notify";

/**
 * The WebSocket notification pipeline.
 *
 * This store is a *trigger*, not a data source. An event says "something about this instance changed";
 * the response is to call the same store action a poller tick would have called. Nothing that arrives
 * on the socket is ever written into a store or rendered — that is what keeps one source of truth and
 * one server-side permission check per read, and it is what makes the whole feature optional: block the
 * socket and the app behaves exactly as it did before it existed.
 *
 * Unset `VITE_WS_BASE_URL` disables it entirely. That mirrors the supported-unset behaviour of the
 * sprite atlas vars, with the same caveat — a missing variable fails quietly, and `.env.local` is
 * gitignored, so both Amplify branches need it set explicitly.
 */

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL;

/** Trailing-edge window for collapsing an event burst into one refetch. */
const DEBOUNCE_MS = 400;
/** Re-arm delay when the target fetch is already in flight. */
const BUSY_RETRY_MS = 500;
/** Keepalive interval. API Gateway closes an idle socket at 10 minutes. */
const PING_MS = 4 * 60 * 1000;
/** How long to wait for a pong before treating the connection as half-open. */
const PONG_TIMEOUT_MS = 20 * 1000;
/**
 * Pre-emptive reconnect window. API Gateway hard-kills every connection at 2 hours, so waiting for
 * that would have every client that connected during a deploy window die at the same instant — a
 * synchronised reconnect storm and a synchronised refetch burst against the game servers. Reconnecting
 * early at a random point inside this window smears it out instead.
 */
const RECYCLE_MIN_MS = 100 * 60 * 1000;
const RECYCLE_MAX_MS = 115 * 60 * 1000;
/** Backoff ceiling. Retries continue forever: an unavailable socket is not an outage, just a slower UI. */
const BACKOFF_CEILING_MS = 30 * 1000;
/** Jitter applied to the on-connect refetch, so N reconnecting tabs don't all hit TShock at once. */
const REFETCH_JITTER_MS = 2000;

/**
 * Which refetch an event implies. Keys are event types; values are logical fetch kinds.
 *
 * `server.players` gets its own kind rather than sharing `serverStatus` because it is the only event
 * whose rate is set by player activity, and the roster is the only thing it can have changed. It maps
 * to the slim `?fields=players` read; everything else needs the full response.
 */
const EVENT_FETCH_KINDS = {
	[REALTIME_EVENTS.SERVER_PLAYERS]: "players",
	[REALTIME_EVENTS.SERVER_STATE]: "serverStatus",
	[REALTIME_EVENTS.SERVER_AUTOSHUTOFF]: "serverStatus",
	[REALTIME_EVENTS.SERVER_VIOLATIONS]: "violations",
	[REALTIME_EVENTS.INSTANCE_STATE]: "instanceStatus",
	[REALTIME_EVENTS.INSTANCE_SHUTDOWN]: "instanceStatus",
	[REALTIME_EVENTS.WORLD_CREATE]: "worldCreate",
};

const jitter = (ms) => Math.floor(Math.random() * ms);

export const useRealtimeStore = defineStore("realtimeStore", {
	state: () => ({
		/** "disabled" | "closed" | "connecting" | "open" */
		status: WS_BASE_URL ? "closed" : "disabled",
		socket: null,
		attempt: 0,
		lastConnectedAt: null,
		/** Keys of the form `${kind}:${instanceId}` awaiting a refetch. */
		dirty: {},
		/** Diagnostics: how many events arrived, and how many refetches they caused. */
		stats: { received: 0, ignored: 0, refetched: 0 },
		_timers: {},
		_pingTimer: null,
		_pongTimer: null,
		_recycleTimer: null,
		_reconnectTimer: null,
		_hubStop: null,
		_visibilityHandler: null,
		/** Guards against two concurrent connect() calls racing to create sockets. */
		_connecting: false,
	}),
	getters: {
		isConfigured: () => Boolean(WS_BASE_URL),
		isOpen: (state) => state.status === "open",
	},
	actions: {
		/**
		 * Opens the socket. Idempotent — the router guard runs on every navigation and App.vue's
		 * created() may run more than once in dev, so this must be safe to call repeatedly.
		 */
		async connect() {
			if (!WS_BASE_URL) {
				console.info("[realtime] disabled: VITE_WS_BASE_URL is not set");
				this.status = "disabled";
				return;
			}

			if (this._connecting || this.status === "open" || this.status === "connecting") {
				return;
			}

			const userStore = useUserStore();
			if (!userStore.isAuthenticated) {
				return;
			}

			this._connecting = true;
			this.status = "connecting";
			this.attachLifecycleListeners();

			try {
				// Traded for the ID token over the ordinary authenticated path, so the handshake URL never
				// carries a durable credential. Reconnects re-mint, which also re-validates the session.
				const { ticket } = await post("/system/realtime/ticket", PERMISSIONS.access, {});
				if (!ticket) {
					throw new Error("No ticket returned");
				}

				const socket = new WebSocket(`${WS_BASE_URL}?ticket=${encodeURIComponent(ticket)}`);
				this.socket = socket;

				socket.onopen = () => this.handleOpen();
				socket.onmessage = (message) => this.handleMessage(message);
				socket.onerror = () => {
					// onerror carries no useful detail by spec and is always followed by onclose, which is
					// where reconnection is handled. Nothing to do here but avoid an unhandled event.
					console.warn("[realtime] socket error");
				};
				socket.onclose = (closeEvent) => this.handleClose(closeEvent);
			} catch (error) {
				// Never surfaced to the user. $alert.error is sticky by design and identical messages
				// collapse, so alerting here would leave one immovable banner about an optional component.
				console.warn("[realtime] connect failed:", error?.message || error);
				this.status = "closed";
				this.scheduleReconnect();
			} finally {
				this._connecting = false;
			}
		},

		handleOpen() {
			this.status = "open";
			this.attempt = 0;
			this.lastConnectedAt = Date.now();
			this.startPing();
			this.scheduleRecycle();

			// The correctness guarantee: anything missed while disconnected is covered by refetching on
			// every (re)connect. Jittered because it is simultaneously the guarantee and the thundering
			// herd — the per-instance loading guards are per-browser and do nothing about N tabs at once.
			setTimeout(() => this.refetchEverything(), jitter(REFETCH_JITTER_MS));
		},

		handleClose(closeEvent) {
			this.stopPing();
			this.clearTimer("_recycleTimer");
			this.socket = null;
			this.status = "closed";

			// 1008 (policy violation) is what API Gateway returns when $connect rejected us. A stale token
			// behind an expired ticket is the plausible cause, so refresh once and retry immediately
			// rather than backing off against a condition that won't clear on its own.
			if (closeEvent?.code === 1008) {
				this.handleAuthFailure();
				return;
			}

			this.scheduleReconnect();
		},

		async handleAuthFailure() {
			const userStore = useUserStore();
			try {
				await userStore.refreshIdToken();
				this.attempt = 0;
				this.connect();
			} catch {
				// Out of options. Stay closed; every poller still works.
				console.warn("[realtime] authentication failed, staying on polling");
				this.status = "closed";
			}
		},

		handleMessage(message) {
			let payload;
			try {
				payload = JSON.parse(message.data);
			} catch {
				return;
			}

			if (payload?.type === "pong") {
				this.clearTimer("_pongTimer");
				return;
			}

			this.onEvent(payload);
		},

		/**
		 * Routes one event to a debounced refetch.
		 *
		 * An unknown type is ignored silently rather than warned about: it means the backend ships an
		 * event this build doesn't mirror yet, and the correct behaviour is to fall through to the
		 * existing poller. That is the forward-compatibility story, not an error.
		 */
		onEvent(event) {
			this.stats.received++;

			if (!event?.type || !event?.instanceId || !KNOWN_REALTIME_EVENTS.has(event.type)) {
				this.stats.ignored++;
				console.debug("[realtime] ignoring unknown event", event?.type);
				return;
			}

			const kind = EVENT_FETCH_KINDS[event.type];
			if (!kind) {
				this.stats.ignored++;
				return;
			}

			if (!this.shouldHandleLocally(event.instanceId)) {
				this.stats.ignored++;
				return;
			}

			const key = `${kind}:${event.instanceId}`;
			this.dirty[key] = true;
			this.scheduleFlush(kind, event.instanceId, DEBOUNCE_MS);
		},

		/**
		 * Filters events this browser has no use for. Not a security boundary — the refetch enforces
		 * that server-side — but it stops us firing requests apiRequest would reject client-side, and
		 * stops us paying a TShock round trip for an instance nothing on screen is showing.
		 */
		shouldHandleLocally(instanceId) {
			const userStore = useUserStore();
			const serverStore = useServerStore();

			if (!userStore.isAuthenticated) return false;
			if (!userStore.hasPermissions(PERMISSIONS.access, false)) return false;

			// Only the selected instance is rendered anywhere today.
			return serverStore.selected.instance === instanceId;
		},

		/** Trailing-edge debounce: one timer per (kind, instance), the last event in a burst wins. */
		scheduleFlush(kind, instanceId, delay) {
			const key = `${kind}:${instanceId}`;
			if (this._timers[key]) {
				clearTimeout(this._timers[key]);
			}
			this._timers[key] = setTimeout(() => {
				delete this._timers[key];
				this.flush(kind, instanceId);
			}, delay);
		},

		/**
		 * Runs the refetch a burst of events collapsed into.
		 *
		 * The busy re-arm is not optional. `fetchServerStatus`/`fetchInstanceStatus` drop a concurrent
		 * call instead of queueing it, and return undefined either way — so firing into an in-flight
		 * fetch silently does nothing and loses the events that asked for it. Keeping the dirty flag and
		 * re-arming is what makes a socket-driven refetch reliable.
		 */
		async flush(kind, instanceId) {
			const serverStore = useServerStore();
			const key = `${kind}:${instanceId}`;

			// worldCreate has no loading guard to collide with, so it never needs the busy re-arm.
			if (kind !== "worldCreate") {
				// "players" shares the server-status flag deliberately — see fetchPlayerList.
				const busy = (kind === "serverStatus" || kind === "players")
					? serverStore.isLoadingServerStatus(instanceId)
					: kind === "violations"
						? serverStore.isLoadingViolations(instanceId)
						: serverStore.isLoadingStatus(instanceId);

				if (busy) {
					this.scheduleFlush(kind, instanceId, BUSY_RETRY_MS);
					return;
				}
			}

			delete this.dirty[key];

			try {
				if (kind === "players") {
					await serverStore.fetchPlayerList(instanceId);
				} else if (kind === "serverStatus") {
					await serverStore.fetchServerStatus(instanceId);
				} else if (kind === "violations") {
					await this.announceViolations(instanceId);
				} else if (kind === "worldCreate") {
					await this.trackWorldCreate(instanceId);
				} else {
					await serverStore.fetchInstanceStatus(instanceId);
				}
				this.stats.refetched++;
			} catch (error) {
				console.warn(`[realtime] refetch (${kind}) failed:`, error?.message || error);
			}

			// Events that arrived while the fetch was running.
			if (this.dirty[key]) {
				this.scheduleFlush(kind, instanceId, DEBOUNCE_MS);
			}
		},

		/**
		 * Refetches the violation set and announces whoever is newly flagged.
		 *
		 * Emphatically does **not** start a poller, unlike `trackWorldCreate`. The distinction is what
		 * bounds the event's frequency: a worldgen job fires a handful of events against one fixed task
		 * ID, whereas this fires on player activity — five joins against a 5s poller would be a hundred
		 * requests, each reaching the game server. The event *is* the trigger here; there is nothing to
		 * poll for afterwards.
		 *
		 * The notification is driven by the refetched data, never by the event: the event carries only a
		 * count as its hint, and a name arriving over the socket would be display data on a channel with
		 * no per-resource permission check behind it.
		 */
		async announceViolations(instanceId) {
			const serverStore = useServerStore();
			const userStore = useUserStore();

			if (!userStore.hasPermissions(PERMISSIONS.server.player.inventory.violations.read, false)) {
				return;
			}

			const fresh = await serverStore.fetchViolations(instanceId, { notify: true });
			if (!fresh?.length) return;

			const violations = serverStore.getViolations(instanceId);

			for (const player of fresh) {
				const violation = violations[player];
				if (!violation) continue;

				const itemCount = violation.itemCount ?? violation.items?.length ?? 0;
				const first = violation.items?.[0]?.name;

				notifyViolation({
					title: "Item rule violation",
					body: `${player} joined with ${itemCount} flagged item${itemCount === 1 ? "" : "s"}${first ? ` (${first}${itemCount > 1 ? ", …" : ""})` : ""}.`,
					// One notification per player rather than one per rescan of the same offence.
					tag: `violation:${instanceId}:${player}`,
				});
			}
		},

		/**
		 * Picks up a worldgen job this browser didn't start.
		 *
		 * This is the one event kind that legitimately starts a poller, and it is safe for a specific
		 * reason: `CREATE_WORLD_CHECK` is a single fixed task ID and `startRepeatingTask` allows exactly
		 * one poller per ID (a second call silently returns), so repeated `world.create` events cannot
		 * stack pollers. Contrast `server.players`, where frequency is bounded by player activity rather
		 * than job lifecycle — starting a poller there would multiply requests without limit.
		 *
		 * Starting the poller is also what makes it unnecessary to publish worldgen heartbeats: this
		 * browser now polls for its own live `detail`, exactly as the initiating browser does.
		 */
		async trackWorldCreate(instanceId) {
			const serverStore = useServerStore();
			const statusStore = useStatusStore();

			const status = await serverStore.fetchWorldCreateStatus(instanceId);
			if (!status || !serverStore.isCreatingWorld(instanceId)) {
				return;
			}

			// Nothing to do if a poller is already running — including the initiator's own.
			if (statusStore.isTaskRunning(TASK_IDS.CREATE_WORLD_CHECK)) {
				return;
			}

			// Seeded with the status just read, because startRepeatingTask evaluates its stop condition
			// at the top of the first tick: against a stale terminal status it would cancel immediately
			// and fire the end handler, announcing an outcome for a job that is still running.
			statusStore.startRepeatingTask(
				TASK_IDS.CREATE_WORLD_CHECK,
				() => {
					const job = serverStore.getWorldCreateStatus(instanceId);
					if (!job) return true;
					return ["completed", "failed"].includes(job.status) || Boolean(job.abandoned);
				},
				5000,
				180,
			);
		},

		/** Refetches whatever the current page needs. Called on every (re)connect. */
		async refetchEverything() {
			const serverStore = useServerStore();
			const instanceId = serverStore.selected.instance;
			if (!instanceId || !this.shouldHandleLocally(instanceId)) {
				return;
			}

			const userStore = useUserStore();

			try {
				if (userStore.hasPermissions(PERMISSIONS.instance.status.read, false)) {
					await serverStore.fetchInstanceStatus(instanceId);
				}
				if (userStore.hasPermissions(PERMISSIONS.server.status.read, false)) {
					await serverStore.fetchServerStatus(instanceId);
				}
				// Also picks up a creation that started while we were disconnected, which is what keeps
				// the guard correct across a reconnect rather than only from the event that opened it.
				if (userStore.hasPermissions(PERMISSIONS.server.world.create, false)) {
					await this.trackWorldCreate(instanceId);
				}
				// Deliberately without `notify`: a reconnect happens whenever a laptop wakes or a tab is
				// refocused, and announcing whatever the set already contained would fire notifications
				// for violations that are hours old.
				if (userStore.hasPermissions(PERMISSIONS.server.player.inventory.violations.read, false)) {
					await serverStore.fetchViolations(instanceId);
				}
			} catch (error) {
				console.warn("[realtime] reconnect refetch failed:", error?.message || error);
			}
		},

		startPing() {
			this.stopPing();
			this._pingTimer = setInterval(() => {
				if (this.socket?.readyState !== WebSocket.OPEN) return;

				this.socket.send(JSON.stringify({ action: "ping" }));

				// No pong means a half-open connection: the socket looks fine locally but nothing is
				// getting through. Close it so onclose drives a reconnect.
				this.clearTimer("_pongTimer");
				this._pongTimer = setTimeout(() => {
					console.warn("[realtime] no pong, recycling connection");
					this.socket?.close();
				}, PONG_TIMEOUT_MS);
			}, PING_MS);
		},

		stopPing() {
			this.clearTimer("_pingTimer", true);
			this.clearTimer("_pongTimer");
		},

		scheduleRecycle() {
			this.clearTimer("_recycleTimer");
			const delay = RECYCLE_MIN_MS + jitter(RECYCLE_MAX_MS - RECYCLE_MIN_MS);
			this._recycleTimer = setTimeout(() => {
				if (this.status === "open") {
					this.socket?.close();
				}
			}, delay);
		},

		scheduleReconnect() {
			this.clearTimer("_reconnectTimer");
			const base = Math.min(BACKOFF_CEILING_MS, 1000 * 2 ** this.attempt);
			const delay = Math.floor(base * (0.5 + Math.random()));
			this.attempt++;
			this._reconnectTimer = setTimeout(() => this.connect(), delay);
		},

		/**
		 * Reconnect when a hidden tab becomes visible.
		 *
		 * Browsers clamp setInterval to a minute or worse in background tabs, so the keepalive is not
		 * reliably delivered and a backgrounded socket idles out. That is not worth fighting — a
		 * visibility-driven reconnect does a full refetch, which is strictly better than whatever the
		 * tab missed.
		 */
		attachLifecycleListeners() {
			if (!this._visibilityHandler) {
				this._visibilityHandler = () => {
					if (document.visibilityState === "visible" && this.status === "closed") {
						this.attempt = 0;
						this.connect();
					}
				};
				document.addEventListener("visibilitychange", this._visibilityHandler);
			}

			// Listened for here rather than by editing userStore.signOut: this store already imports
			// userStore for the ticket call, so the reverse dependency would be circular.
			if (!this._hubStop) {
				this._hubStop = Hub.listen("auth", ({ payload }) => {
					if (payload?.event === "signedOut" || payload?.event === "tokenRefresh_failure") {
						this.disconnect();
					}
				});
			}
		},

		clearTimer(name, isInterval = false) {
			if (this[name]) {
				isInterval ? clearInterval(this[name]) : clearTimeout(this[name]);
				this[name] = null;
			}
		},

		disconnect() {
			this.stopPing();
			this.clearTimer("_recycleTimer");
			this.clearTimer("_reconnectTimer");

			Object.values(this._timers).forEach(clearTimeout);
			this._timers = {};
			this.dirty = {};

			if (this._visibilityHandler) {
				document.removeEventListener("visibilitychange", this._visibilityHandler);
				this._visibilityHandler = null;
			}
			if (this._hubStop) {
				this._hubStop();
				this._hubStop = null;
			}

			if (this.socket) {
				// Detach handlers first so our own close doesn't schedule a reconnect.
				this.socket.onclose = null;
				this.socket.onerror = null;
				this.socket.onmessage = null;
				this.socket.onopen = null;
				this.socket.close();
				this.socket = null;
			}

			this.attempt = 0;
			this.status = WS_BASE_URL ? "closed" : "disabled";
		},
	},
});
