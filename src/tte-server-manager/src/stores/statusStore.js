import { defineStore } from "pinia";

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
				(this.subscriptions[taskID] || []).forEach(h => h.handler());

				iterations++;

				if (stopCondition() || iterations >= maxRepeats) {
					this.cancelRepeatingTask(taskID);
				}
			}, interval);
		},
		cancelRepeatingTask(taskID) {
			clearInterval(this.intervals[taskID]);
			delete this.intervals[taskID];
			(this.endSubscriptions[taskID] || []).forEach(h => h.handler());
		},
		subscribeToTask(taskID, handler, handlerID = null) {
			if (!this.subscriptions[taskID]) {
				this.subscriptions[taskID] = [];
			}

			this.subscriptions[taskID].push({ handler, id: handlerID });
		},
		subscribeToTaskEnd(taskID, handler) {
			if (!this.endSubscriptions[taskID]) {
				this.endSubscriptions[taskID] = [];
			}

			this.endSubscriptions[taskID].push({ handler });
		}
	}
});

export const TASK_IDS = {
	INSTANCE_STATUS_CHECK: "instance_status_check",
	SERVER_STATUS_CHECK: "server_status_check",
	CREATE_WORLD_CHECK: "create_world_check",
};
