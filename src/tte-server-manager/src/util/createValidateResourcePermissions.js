import { useAlerts } from './alerts'
import { useUserStore } from '@/stores/userStore'

/**
 * Create a resource permission validation function that throws on failure
 * @returns {Function} validate(resourcesRequired, requireAll, options) - throws on failure
 */
export const createValidateResourcePermissions = () => {
	const { error } = useAlerts();
	const userStore = useUserStore();

	return (resourcesRequired, requireAll = true, options = {}) => {
		if (!userStore.isAuthenticated) {
			const message = options.message || 'You must be logged in to perform this action';
			error(message)
			throw new Error(message)
		}

		const hasRequired = requireAll
			? userStore.hasResourceAccess(resourcesRequired, true)
			: userStore.hasResourceAccess(resourcesRequired, false);

		if (!hasRequired) {
			const message = options.message || 'You do not have access to this resource';
			error(message);
			throw new Error(message);
		}

		return true;
	}
}

/**
 * Create a resource permission checker function that returns a boolean
 * @returns {Function} check(resourcesRequired, requireAll, options) - returns boolean
 */
export const createCheckResourcePermissions = () => {
	const userStore = useUserStore();

	return (resourcesRequired, requireAll = true, options = {}) => {
		if (!userStore.isAuthenticated) {
			return false;
		}

		const hasRequired = requireAll
			? userStore.hasResourceAccess(resourcesRequired, true)
			: userStore.hasResourceAccess(resourcesRequired, false);

		if (!hasRequired) {
			return false;
		}

		return true;
	}
}

/**
 * Composable to use the throwing validator (for Composition API)
 * @returns {Function} validate(resourcesRequired, requireAll, options) - throws on failure
 */
export const useValidateResourcePermissions = () => {
	return createValidateResourcePermissions();
}

/**
 * Composable to use the boolean checker (for Composition API)
 * @returns {Function} check(resourcesRequired, requireAll, options) - returns boolean
 */
export const useCheckResourcePermissions = () => {
	return createCheckResourcePermissions();
}
