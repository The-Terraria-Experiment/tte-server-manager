import { useUserStore } from '@/stores/userStore';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

/**
 * Make an authenticated API request
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} endpoint - API endpoint path (e.g., '/instances')
 * @param {object} options - Request options
 * @param {object} options.body - Request body for POST/PUT
 * @param {string} options.permission - Required permission to check (e.g., 'instance.list')
 * @returns {Promise<any>} Response data
 * @throws {Error} If not authenticated, lacks permission, or request fails
 */
export async function apiRequest(method, endpoint, options = {}) {
	const userStore = useUserStore();
	
	// Check authentication
	if (!userStore.isAuthenticated) {
		throw new Error('User is not authenticated');
	}
	
	// Get ID token for authorization
	const idToken = await userStore.getIdToken();
	if (!idToken) {
		throw new Error('Failed to retrieve authentication token');
	}
	
	// Check permissions if required
	if (options.permission) {
		const hasPermission = userStore.hasPermission(options.permission);
		if (!hasPermission) {
			throw new Error(`Insufficient permissions: ${options.permission}`);
		}
	}
	
	// Build request
	const requestInit = {
		method,
		headers: {
			'Authorization': `Bearer ${idToken}`,
			'Content-Type': 'application/json',
		},
	};
	
	if (options.body && (method === 'POST' || method === 'PUT')) {
		requestInit.body = JSON.stringify(options.body);
	}
	
	// Make request
	const url = `${API_BASE_URL}${endpoint}`;
	const response = await fetch(url, requestInit);
	
	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		throw new Error(errorData.message || `API error: ${response.status} ${response.statusText}`);
	}
	
	return response.json();
}

/**
 * GET request
 */
export function get(endpoint, options = {}) {
	return apiRequest('GET', endpoint, options);
}

/**
 * POST request
 */
export function post(endpoint, body, options = {}) {
	return apiRequest('POST', endpoint, { body, ...options });
}

/**
 * PUT request
 */
export function put(endpoint, body, options = {}) {
	return apiRequest('PUT', endpoint, { body, ...options });
}

/**
 * DELETE request
 */
export function deleteRequest(endpoint, options = {}) {
	return apiRequest('DELETE', endpoint, options);
}