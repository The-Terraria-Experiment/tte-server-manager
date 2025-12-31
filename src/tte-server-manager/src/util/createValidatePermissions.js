import { useAlerts } from './alerts'
import { useUserStore } from '@/stores/userStore'

/**
 * Create a permission validation function that throws on failure
 * @returns {Function} validate(permissionRequired, requireAll, options) - throws on failure
 */
export const createValidatePermissions = () => {
	const { error } = useAlerts();
	const userStore = useUserStore();

	return (permissionRequired, requireAll = true, options = {}) => {
		if (!userStore.isAuthenticated) {
			const message = options.message || 'You must be logged in to perform this action';
			error(message)
			throw new Error(message)
		}

		const hasRequired = requireAll
			? userStore.hasPermissions(permissionRequired, true)
			: userStore.hasPermissions(permissionRequired, false);

		if (!hasRequired) {
			const message = options.message || 'You do not have permission to perform this action';
			error(message);
			throw new Error(message);
		}

		return true;
	}
}

/**
 * Create a permission checker function that returns a boolean
 * @returns {Function} check(permissionRequired, requireAll, options) - returns boolean
 */
export const createCheckPermissions = () => {
	const userStore = useUserStore();

	return (permissionRequired, requireAll = true, options = {}) => {
		if (!userStore.isAuthenticated) {
			return false;
		}

		const hasRequired = requireAll
			? userStore.hasPermissions(permissionRequired, true)
			: userStore.hasPermissions(permissionRequired, false);

		if (!hasRequired) {
			return false;
		}

		return true;
	}
}

/**
 * Composable to use the throwing validator (for Composition API)
 * @returns {Function} validate(permissionRequired, requireAll, options) - throws on failure
 */
export const useValidatePermissions = () => {
	return createValidatePermissions();
}

/**
 * Composable to use the boolean checker (for Composition API)
 * @returns {Function} check(permissionRequired, requireAll, options) - returns boolean
 */
export const useCheckPermissions = () => {
	return createCheckPermissions();
}
