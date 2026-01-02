import { useAlertStore } from '../stores/alertStore'

const pushWithType = (store, type, message, options = {}) => {
	return store.push({
		...options,
		type,
		message,
	});
};

export const createAlertHelpers = (store) => ({
	notify(payload) {
		return store.push(payload);
	},
	success(message, options = {}) {
		return pushWithType(store, 'success', message, options);
	},
	error(message, options = {}) {
		return pushWithType(store, 'error', message, options);
	},
	warning(message, options = {}) {
		return pushWithType(store, 'warning', message, options);
	},
	info(message, options = {}) {
		return pushWithType(store, 'info', message, options);
	},
	dismiss(id) {
		return store.remove(id);
	},
	clear() {
		return store.clear();
	},
});

export const useAlerts = () => {
	const store = useAlertStore();
	return createAlertHelpers(store);
};
