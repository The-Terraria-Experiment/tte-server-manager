import { defineStore } from 'pinia'
import { getCurrentUser, fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth';

export const useUserStore = defineStore("userstore", {
	state: () => ({
		user: null,
		idToken: null,
		permissions: [],
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
				this.__userFetchedCallbacks.forEach(cb => cb());
				this.__userFetchedCallbacks = [];
			} catch (error) {
				this.user = null;
				this.idToken = null;
				this.permissions = [];
			}
		},
		async loadPermissions() {
			try {
				const idToken = await this.getIdToken();
				const response = await fetch(
					`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/users/permissions/getown`,
					{
						headers: {
							'Authorization': `Bearer ${idToken}`,
						},
					}
				);
				
				if (response.ok) {
					const data = await response.json();
					this.accountData = data?.entries || null;
					this.permissions = data?.entries?.permissions || [];
					this.user.displayName = data?.entries?.displayName || "";
					this.user.username = data?.entries?.username || "";
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