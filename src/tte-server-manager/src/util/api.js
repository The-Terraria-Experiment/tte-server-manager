import { useUserStore } from '@/stores/userStore';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

/**
 * Get the user store instance (lazy evaluation)
 */
function getUserStore() {
	return useUserStore();
}

/**
 * Make an authenticated API request
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} endpoint - API endpoint path (e.g., '/instances')
 * @param {string} permission - Permission required to call this endpoint
 * @param {object} options - Request options
 * @param {object} options.body - Request body for POST/PUT
 * @returns {Promise<any>} Response data
 * @throws {Error} If not authenticated, lacks permission, or request fails
 */
export async function apiRequest(method, endpoint, permission, options = {}) {
	const userStore = getUserStore();
	
	// Check authentication
	if (!userStore.isAuthenticated) {
		throw new Error('User is not authenticated');
	}
	
	// Check permissions if required
	if (permission) {
		const hasPermission = userStore.hasPermission(permission);
		if (!hasPermission) {
			throw new Error(`Insufficient permissions:`, permission);
		}
	}

	// Make request with automatic token refresh on 401
	return makeRequestWithRetry(method, endpoint, options, 0);
}

/**
 * Make an API request with automatic retry on token expiration
 * @private
 */
async function makeRequestWithRetry(method, endpoint, options, retryCount) {
	const userStore = getUserStore();
	const maxRetries = 1;
	
	// Get fresh ID token
	let idToken = await userStore.getIdToken();
	if (!idToken) {
		throw new Error('Failed to retrieve authentication token');
	}
	
	const isFormData = options && options.body && options.body instanceof FormData;
	
	// Build request
	const requestInit = {
		method,
		headers: {
			'Authorization': `Bearer ${idToken}`,
			...(isFormData ? {} : { 'Content-Type': 'application/json' }),
			...options.headers
		},
	};
	
	if (options.body && (method === 'POST' || method === 'PUT')) {
		if (isFormData) {
			requestInit.body = options.body;
		} else {
			requestInit.body = JSON.stringify(options.body);
		}
	}
	
	// Make request
	const url = `${API_BASE_URL}${endpoint}`;
	const response = await fetch(url, requestInit);
	
	// Handle 401 Unauthorized - likely expired token
	if (response.status === 401 && retryCount < maxRetries) {
		try {
			// Refresh the token and retry
			await userStore.refreshIdToken();
			return makeRequestWithRetry(method, endpoint, options, retryCount + 1);
		} catch (error) {
			// Refresh failed, sign out and throw error
			await userStore.signOut();
			throw new Error('Session expired. Please sign in again.');
		}
	}
	
	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		throw new Error(errorData.message || `API error: ${response.status} ${response.statusText}`);
	}
	
	return response.json();
}

/**
 * GET request
 * @param {string} endpoint
 * @param {string} permission
 * @param {object} options
 * @return {Promise}
 */
export function get(endpoint, permission, options = {}) {
	return apiRequest('GET', endpoint, permission, options);
}

/**
 * POST request
 * @param {string} endpoint
 * @param {string} permission
 * @param {object} body
 * @param {object} options
 * @return {Promise}
 */
export function post(endpoint, permission, body, options = {}) {
	return apiRequest('POST', endpoint, permission, { body, ...options });
}

/**
 * PUT request
 * @param {string} endpoint
 * @param {string} permission
 * @param {object} body
 * @param {object} options
 * @return {Promise}
 */
export function put(endpoint, body, permission, options = {}) {
	return apiRequest('PUT', endpoint, permission, { body, ...options });
}

/**
 * DELETE request
 * @param {string} endpoint
 * @param {string} permission
 * @param {object} options
 * @return {object}
 */
export function deleteRequest(endpoint, permission, options = {}) {
	return apiRequest('DELETE', endpoint, permission, options);
}