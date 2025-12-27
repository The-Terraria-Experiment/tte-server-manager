import { defineStore } from 'pinia'
import { getCurrentUser, fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth';

export const useUserStore = defineStore("userstore", {
	state: () => ({
		user: null,
		idToken: null,
	}),
	getters: {
		isAuthenticated: (state) => !!state.user,
		username: (state) => state.user?.username || null,
	},
	actions: {
		async loadUser() {
			try {
				const user = await getCurrentUser();
				const session = await fetchAuthSession();
				this.user = user;
				this.idToken = session.tokens?.idToken?.toString() || null;
			} catch (error) {
				this.user = null;
				this.idToken = null;
			}
		},
		async signOut() {
			try {
				await amplifySignOut();
				this.user = null;
				this.idToken = null;
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