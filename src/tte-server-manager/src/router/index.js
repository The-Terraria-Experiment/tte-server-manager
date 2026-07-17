import { createRouter, createWebHistory } from "vue-router"
import { useUserStore } from "../stores/userStore";

export const router = createRouter({
	history: createWebHistory(),
	routes: [
		{ path: "/terms-and-conditions-privacy-policy", component: () => import("../components/pages/Terms.vue"), meta: { requiresAuth: false } },
		{ path: "/login", component: () => import("../components/pages/Login.vue"), meta: { requiresAuth: false } },
		{ path: "/overview", component: () => import("../components/pages/Overview.vue"), meta: { requiresAuth: true } },
		{ path: "/instance", component: () => import("../components/pages/Instance.vue"), meta: { requiresAuth: true } },
		{ path: "/server", component: () => import("../components/pages/Server.vue"), meta: { requiresAuth: true } },
		{ path: "/users", component: () => import("../components/pages/Users.vue"), meta: { requiresAuth: true } },
		{ path: "/", component: () => import("../components/pages/Overview.vue"), meta: { requiresAuth: false } },
		{ path: "/:pathMatch(.*)*", redirect: "/" }, // catch-all
	]
});

router.beforeEach(async (to) => {
	const user = useUserStore();
	
	// Always try to load/restore user state on navigation
	if (!user.isAuthenticated) {
		await user.loadUser();
	}
	
	if (to.meta.requiresAuth && !user.isAuthenticated) {
		return { path: "/login", query: { redirect: to.fullPath } };
	}
})