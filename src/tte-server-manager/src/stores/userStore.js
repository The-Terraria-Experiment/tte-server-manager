import { defineStore } from 'pinia'
import { getCurrentUser, fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth';

export const useUserStore = defineStore("userstore", {
	state: () => ({
		user: null,
		idToken: null,
		permissions: [],
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
		async loadUser() {
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
					this.permissions = data.permissions || [];
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
		}
	}
});