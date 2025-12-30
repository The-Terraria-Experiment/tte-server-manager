import { useUserStore } from '@/stores/userStore';

/**
 * Validate if current user has required permission(s)
 * Uses cached permissions from the store
 * @param {string|string[]} permissionRequired - Single permission or array of permissions
 * @param {boolean} requireAll - If true, user must have ALL permissions; if false, user needs ANY one
 * @returns {boolean} True if user has required permission(s)
 */
export default function validatePermissions(permissionRequired, requireAll = true) {
	const userStore = useUserStore();
	
	if (!userStore.isAuthenticated) {
		return false;
	}
	
	return requireAll 
		? userStore.hasPermissions(permissionRequired, true)
		: userStore.hasPermissions(permissionRequired, false);
}