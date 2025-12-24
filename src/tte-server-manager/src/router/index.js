import { createRouter, createWebHistory } from "vue-router"
import Home from "../components/pages/Home.vue";
import Overview from "../components/pages/Overview.vue";
import Instance from "../components/pages/Instance.vue";
import Server from "../components/pages/Server.vue";
import Users from "../components/pages/Users.vue";
import { useUserStore } from "../stores/userStore";

export const router = createRouter({
	history: createWebHistory(),
	routes: [
		{ path: "/overview", component: Overview, meta: { requiresAuth: true } },
		{ path: "/instance", component: Instance, meta: { requiresAuth: true } },
		{ path: "/server", component: Server, meta: { requiresAuth: true } },
		{ path: "/users", component: Users, meta: { requiresAuth: true } },
		{ path: "/", component: Home, meta: { requiresAuth: false } },
		{ path: "/:pathMatch(.*)*", redirect: "/" }, // catch-all
	]
});

router.beforeEach((to) => {
	const user = useUserStore();
	if (to.meta.requiresAuth && !user.isAuthenticated) {
		return { path: "/", query: { redirect: to.fullPath } };
	}
})