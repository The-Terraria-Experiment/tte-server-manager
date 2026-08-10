import { defineStore } from 'pinia'

const DEFAULT_DURATION = 5000;
const MAX_ALERTS = 5;

/**
 * Errors don't auto-dismiss. They're the alerts that carry information the user has to act on — a
 * failure reason, a name to check, a reason a job stopped — and a five-second window means the one
 * message worth reading is the one most likely to be missed. Everything else is an acknowledgement
 * and can expire on its own. Callers can still pass an explicit `duration` to override either way.
 */
const STICKY_TYPES = new Set(['error']);

const defaultDurationFor = (type) => (STICKY_TYPES.has(type) ? 0 : DEFAULT_DURATION);

const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const useAlertStore = defineStore('alertstore', {
	state: () => ({
		alerts: [],
	}),
	actions: {
		push(payload) {
			const id = payload?.id || generateId();
			const type = payload?.type || 'info';
			const alert = {
				id,
				type,
				message: payload?.message || '',
				description: payload?.description || '',
				duration: payload?.duration ?? defaultDurationFor(type),
				// A sticky alert has to stay dismissible, or it can never leave the screen.
				dismissible: payload?.dismissible !== false || defaultDurationFor(type) === 0,
			};

			// Identical back-to-back messages are almost always one event reported twice rather than
			// two things going wrong, and stacking them buries whatever came before.
			const duplicate = this.alerts.find(existing => existing.type === alert.type && existing.message === alert.message);
			if (duplicate) {
				return duplicate.id;
			}

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
