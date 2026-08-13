import { defineStore } from 'pinia'
import { getCurrentUser, fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth';

const USE_CACHE = true;
const CACHE_TTL = 3 * 60 * 1000; /// 3min
const CACHE_KEY = "ttesm-user-cache";

/**
 * Runway an ID token must still have to be worth sending. Below this it's treated as expired, so a
 * request never spends a round trip discovering that for itself.
 */
const TOKEN_MIN_REMAINING_MS = 60 * 1000;

/** How long `ensureUserFetched` waits before giving up and reporting signed-out. */
const USER_FETCH_TIMEOUT_MS = 15 * 1000;

/**
 * True when the stored token is expired, nearly expired, or unreadable.
 *
 * The store holds the token as a plain string with a fixed lifetime, so "we have one" is not the
 * same as "it works": between expiry and the first 401 every request is guaranteed to fail against
 * the API Gateway authorizer. Reading `exp` locally closes that window without a network call. An
 * unparseable token counts as expiring — refreshing costs one request, being wrong costs a 401 for
 * every call the page makes.
 */
function isIdTokenExpiring(token) {
	try {
		const [, payload] = token.split(".");
		if (!payload) return true;

		const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
		const { exp } = JSON.parse(atob(padded));
		if (!exp) return true;

		return exp * 1000 - Date.now() <= TOKEN_MIN_REMAINING_MS;
	} catch {
		return true;
	}
}

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
		// Cognito lowercases the provider prefix in the federated usernames it generates
		// ("patreon_<id>"), so the username fallback has to match case-insensitively. It only
		// covers records created before patreonLinked was persisted at signup.
		isPatreonLinked: (state) =>
			Boolean(state.accountData?.patreonLinked) ||
			Boolean(state.accountData?.username?.toLowerCase().startsWith("patreon_")),
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
			// Flush before the early return too, not just in the finally below. A waiter registered
			// while `user` was still null is otherwise stranded by the next call that short-circuits
			// here, and nothing else ever resolves it.
			if (this.user && !forceReload) {
				this.__flushUserFetched();
				return;
			}

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
				this.__flushUserFetched();
			}
		},
		__flushUserFetched() {
			this.__userFetchedCallbacks.forEach(cb => cb());
			this.__userFetchedCallbacks = [];
		},
		async loadPermissions() {
			try {
				const idToken = await this.getIdToken();

				const applyUserData = (data) => {
					this.accountData = data?.entries || null;
					this.permissions = data?.entries?.permissions || [];
					this.resourceAccess = data?.entries?.resourceAccess || [];
					this.user.displayName = data?.entries?.displayName || "";
					this.user.username = data?.entries?.username || "";
				};

				let existingCache;
				try {
					existingCache = JSON.parse(sessionStorage.getItem(CACHE_KEY));
				} catch (e) {
					existingCache = null;
				}
				if (USE_CACHE && existingCache && existingCache.expiresAt > Date.now() && existingCache.entries) {
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
						if (!data || !Object.values(data).length) {
							throw new Error("No perm data");
						}
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
				return this.idToken;
			}

			if (isIdTokenExpiring(this.idToken)) {
				await this.refreshIdToken();
			}

			return this.idToken;
		},
		async refreshIdToken() {
			try {
				// forceRefresh, because this is only ever called when the token we already have is
				// known to be unusable — a plain fetchAuthSession can hand back the same cached
				// token, which is how a 401 turned into a second 401 on the retry rather than a
				// recovery.
				const session = await fetchAuthSession({ forceRefresh: true });
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

			// Bounded, because this promise gates the whole app behind App.vue's loading state and
			// its only resolver is loadUser() reaching a flush. Anything that hangs inside Amplify's
			// session resolution - which it can do with no network call, no error and no timeout of
			// its own - otherwise leaves every route stuck on "Loading user data..." forever. Timing
			// out here degrades to signed-out, which the router already handles. Generous on purpose:
			// a real session resolution is one token round trip, so this should never fire in normal
			// use, and a slow network shouldn't get treated as a hang.
			const timeout = new Promise((resolve) => {
				setTimeout(() => {
					if (!this.user) console.warn("[auth] user fetch timed out; continuing signed-out");
					resolve(false);
				}, USER_FETCH_TIMEOUT_MS);
			});

			return Promise.race([waiter, timeout]);
		}
	}
});