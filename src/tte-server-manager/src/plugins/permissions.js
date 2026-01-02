import { createValidatePermissions, createCheckPermissions } from '../util/createValidatePermissions'

export default {
	install(app) {
		const validate = createValidatePermissions();
		const check = createCheckPermissions();

		app.config.globalProperties.$validatePermissions = validate;
		app.provide('validatePermissions', validate);

		app.config.globalProperties.$checkPermissions = check;
		app.provide('checkPermissions', check);
	},
};
