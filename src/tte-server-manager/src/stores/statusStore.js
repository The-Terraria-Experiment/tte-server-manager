import { defineStore } from "pinia";

/**
 * Removes a subscriber by either its explicit ID or its handler reference.
 *
 * Components must drop their subscriptions when they unmount. A handler bound to a component
 * instance is a new function every time that component mounts, so the dedupe in
 * `isAlreadySubscribed` can't recognise it as a repeat: navigating away and back registers another
 * copy, and the task then notifies every stale copy alongside the live one — the same alert two and
 * three times over, fired at components that no longer exist.
 */
const dropSubscriber = (subscribers, handlerOrID) => {
	if (handlerOrID === null || handlerOrID === undefined) {
		return subscribers || [];
	}

	return (subscribers || []).filter(h => h.id !== handlerOrID && h.handler !== handlerOrID);
};

export const useStatusStore = defineStore("statusStore", {
	state: () => ({
		subscriptions: {},
		endSubscriptions: {},
		intervals: {},
	}),
	getters: {
		isTaskRunning: (state) => (taskID) => Boolean(state.intervals[taskID]),
	},
	actions: {
		startRepeatingTask(taskID, stopCondition, interval = 5000, maxRepeats = 20) {
			if (this.intervals[taskID]) {
				return;
			}

			let iterations = 0;
			this.intervals[taskID] = setInterval(() => {
				if (stopCondition() || iterations >= maxRepeats) {
					this.cancelRepeatingTask(taskID);
					return;
				}

				(this.subscriptions[taskID] || []).forEach(h => h.handler());

				iterations++;
			}, interval);
		},
		cancelRepeatingTask(taskID) {
			// Only a task that was actually running can "end". Firing the end handlers on every call
			// turns a redundant cancel — two code paths deciding to stop at once, a cancel for a task
			// that already stopped itself — into a duplicate round of "finished" notifications.
			const wasRunning = Boolean(this.intervals[taskID]);

			clearInterval(this.intervals[taskID]);
			delete this.intervals[taskID];

			if (!wasRunning) {
				return;
			}

			(this.endSubscriptions[taskID] || []).forEach(h => h.handler());
		},
		subscribeToTask(taskID, handler, handlerID = null) {
			if (!this.subscriptions[taskID]) {
				this.subscriptions[taskID] = [];
			}

			if (this.isAlreadySubscribed(this.subscriptions[taskID], handler, handlerID)) {
				return;
			}

			this.subscriptions[taskID].push({ handler, id: handlerID });
		},
		subscribeToTaskEnd(taskID, handler, handlerID = null) {
			if (!this.endSubscriptions[taskID]) {
				this.endSubscriptions[taskID] = [];
			}

			if (this.isAlreadySubscribed(this.endSubscriptions[taskID], handler, handlerID)) {
				return;
			}

			this.endSubscriptions[taskID].push({ handler, id: handlerID });
		},
		unsubscribeFromTask(taskID, handlerOrID) {
			this.subscriptions[taskID] = dropSubscriber(this.subscriptions[taskID], handlerOrID);
		},
		unsubscribeFromTaskEnd(taskID, handlerOrID) {
			this.endSubscriptions[taskID] = dropSubscriber(this.endSubscriptions[taskID], handlerOrID);
		},
		isAlreadySubscribed(subscribers, handler, handlerID) {
			// Dedupe by explicit ID when provided (so inline handlers can still be
			// deduped), otherwise fall back to the handler's function reference.
			if (handlerID !== null) {
				return subscribers.some(h => h.id === handlerID);
			}

			return subscribers.some(h => h.handler === handler);
		}
	}
});

export const TASK_IDS = {
	INSTANCE_STATUS_CHECK: "instance_status_check",
	SERVER_STATUS_CHECK: "server_status_check",
	CREATE_WORLD_CHECK: "create_world_check",
};

/**
 * Task ID for tracking one instance's shutdown.
 *
 * Per-instance rather than a fixed entry in TASK_IDS because `startRepeatingTask` allows exactly one
 * poller per ID and silently ignores any attempt to start a second: a shared ID would mean the first
 * instance to start shutting down is the only one anyone can watch, and the others would sit with a
 * stale tile until something else happened to refresh them.
 */
export const shutdownTaskId = (instanceID) => `instance_shutdown_check:${instanceID}`;
