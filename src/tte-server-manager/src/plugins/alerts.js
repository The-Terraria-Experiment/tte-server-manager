import { createAlertHelpers } from '../util/alerts'
import { useAlertStore } from '../stores/alertStore'

export default {
	install(app) {
		const store = useAlertStore();
		const helpers = createAlertHelpers(store);

		app.config.globalProperties.$alert = helpers;
		app.provide('alert', helpers);
	},
};
