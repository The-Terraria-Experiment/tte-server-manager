import { defineStore } from 'pinia'

const DEFAULT_DURATION = 5000;
const MAX_ALERTS = 5;

const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const useAlertStore = defineStore('alertstore', {
	state: () => ({
		alerts: [],
	}),
	actions: {
		push(payload) {
			const id = payload?.id || generateId();
			const alert = {
				id,
				type: payload?.type || 'info',
				message: payload?.message || '',
				description: payload?.description || '',
				duration: payload?.duration ?? DEFAULT_DURATION,
				dismissible: payload?.dismissible !== false,
			};

			this.alerts.unshift(alert);
			if (this.alerts.length > MAX_ALERTS) {
				this.alerts = this.alerts.slice(0, MAX_ALERTS);
			}

			if (alert.duration && alert.duration > 0) {
				setTimeout(() => this.remove(id), alert.duration);
			}

			return id;
		},
		remove(id) {
			this.alerts = this.alerts.filter(alert => alert.id !== id);
		},
		clear() {
			this.alerts = [];
		},
	},
});
