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

		app.config.globalProperties.$validateResourceAccess = validateResource;
		app.provide('validateResourceAccess', validateResource);

		app.config.globalProperties.$checkResourceAccess = checkResource;
		app.provide('checkResourceAccess', checkResource);
	},
};
