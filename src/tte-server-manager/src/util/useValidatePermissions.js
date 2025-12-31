import { useAlerts } from './alerts'
import { useUserStore } from '@/stores/userStore'

/**
 * Composable to validate permissions with built-in alert handling
 * Use this in components when you want automatic error alerts on permission denial
 * @returns {Function} validate(permissionRequired, requireAll, options) - returns boolean
 */
export const useValidatePermissions = () => {
	const { error } = useAlerts();
	const userStore = useUserStore();

	return (permissionRequired, requireAll = true, options = {}) => {
		if (!userStore.isAuthenticated) {
			error(options.message || 'You must be logged in to perform this action')
			return false;
		}

		const hasRequired = requireAll
			? userStore.hasPermissions(permissionRequired, true)
			: userStore.hasPermissions(permissionRequired, false);

		if (!hasRequired) {
			error(options.message || 'You do not have permission to perform this action');
			throw new Error('You do not have permission to perform this action');
		}
	}
}
