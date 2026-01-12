import { createValidatePermissions, createCheckPermissions } from '../util/createValidatePermissions'
import { createValidateResourcePermissions, createCheckResourcePermissions } from '../util/createValidateResourcePermissions'

export default {
	install(app) {
		const validate = createValidatePermissions();
		const check = createCheckPermissions();

		const validateResource = createValidateResourcePermissions();
		const checkResource = createCheckResourcePermissions();

		app.config.globalProperties.$validatePermissions = validate;
		app.provide('validatePermissions', validate);

		app.config.globalProperties.$checkPermissions = check;
		app.provide('checkPermissions', check);

		app.config.globalProperties.$validateResourcePermissions = validateResource;
		app.provide('validateResourcePermissions', validateResource);

		app.config.globalProperties.$checkResourcePermissions = checkResource;
		app.provide('checkResourcePermissions', checkResource);
	},
};
