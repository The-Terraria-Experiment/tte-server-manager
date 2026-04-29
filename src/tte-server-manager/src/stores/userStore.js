import { defineStore } from 'pinia'
import { getCurrentUser, fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth';

const USE_CACHE = true;
const CACHE_TTL = 3 * 60 * 1000; /// 3min
const CACHE_KEY = "ttesm-user-cache";

export const useUserStore = defineStore("userstore", {
	state: () => ({
		user: null,
		idToken: null,
		permissions: [],
		resourceAccess: [],
		accountData: null,
		__userFetchedCallbacks: []
	}),
	getters: {
		isAuthenticated: (state) => !!state.user,
		username: (state) => state.user?.username || null,
		hasPermission: (state) => (permission) => {
			return state.permissions.includes(permission);
		},
		hasPermissions: (state) => (permissions, requireAll = true) => {
			const perms = Array.isArray(permissions) ? permissions : [permissions];
			if (requireAll) {
				return perms.every(perm => state.permissions.includes(perm));
			} else {
				return perms.some(perm => state.permissions.includes(perm));
			}
		},
		hasResourceAccess: (state) => (resources, requireAll = true) => {
			const resourcePerms = Array.isArray(resources) ? resources : [resources];
			if (requireAll) {
				return resourcePerms.every(rperm => state.resourceAccess.includes(rperm));
			} else {
				return resourcePerms.some(rperm => state.resourceAccess.includes(rperm));
			}
		}
	},
	actions: {
		async loadUser(forceReload = false) {
			if (this.user && !forceReload) return;

			try {
				const user = await getCurrentUser();
				const session = await fetchAuthSession();
				this.user = user;
				this.idToken = session.tokens?.idToken?.toString() || null;
				// Load permissions after successful login
				await this.loadPermissions();
			} catch (error) {
				this.user = null;
				this.idToken = null;
				this.permissions = [];
			} finally {
				this.__userFetchedCallbacks.forEach(cb => cb());
				this.__userFetchedCallbacks = [];
			}
		},
		async loadPermissions() {
			try {
				const idToken = await this.getIdToken();

				const applyUserData = (data) => {
					this.accountData = data?.entries || null;
					this.permissions = data?.entries?.permissions || [];
					this.resourceAccess = data?.entries.resourceAccess || [];
					this.user.displayName = data?.entries?.displayName || "";
					this.user.username = data?.entries?.username || "";
				};

				let existingCache;
				try {
					existingCache = JSON.parse(sessionStorage.getItem(CACHE_KEY));
				} catch (e) {
					existingCache = null;
				}
				if (USE_CACHE && existingCache && existingCache.expiresAt > Date.now()) {
					applyUserData(existingCache);
				} else {
					const response = await fetch(
						`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/users/permissions/getown`,
						{
							headers: {
								'Authorization': `Bearer ${idToken}`,
							},
						}
					);
					
					let data;
					if (response.ok) {
						data = await response.json();
						applyUserData(data);
					}

					if (USE_CACHE) {
						const userCacheData = {
							...data,
							expiresAt: Date.now() + CACHE_TTL
						}
						sessionStorage.setItem(CACHE_KEY, JSON.stringify(userCacheData));
					}
				}
			} catch (error) {
				console.error('Failed to load permissions:', error);
				this.permissions = [];
			}
		},
		async signOut() {
			try {
				await amplifySignOut();
				this.user = null;
				this.idToken = null;
				this.permissions = [];
			} catch (error) {
				console.error('Sign out error:', error);
			}
		},
		async getIdToken() {
			if (!this.idToken) {
				await this.loadUser();
			}
			return this.idToken;
		},
		async refreshIdToken() {
			try {
				const session = await fetchAuthSession();
				this.idToken = session.tokens?.idToken?.toString() || null;
				return this.idToken;
			} catch (error) {
				console.error('Token refresh failed:', error);
				throw error;
			}
		},
		async ensureUserFetched() {
			if (!!this.user) return true;
			
			let waiterResolve;
			const waiter = new Promise((resolve) => {
				waiterResolve = resolve;
			});

			this.__userFetchedCallbacks.push(waiterResolve);

			return waiter;
		}
	}
});