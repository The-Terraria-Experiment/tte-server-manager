<template>
	<StatusTile
		:perm-required="PERMISSIONS.instance.list"
		:loading="serverStore.isLoadingFleet"
		collapsible
		start-open
	>
		<template #header>
			<Icon icon="server" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Servers</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">{{ summaryText }}</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<div class="flex items-center justify-between flex-wrap gap-2 mb-4">
					<p class="text-sm text-gray-7">
						Every server you have access to. Click one to manage it.
					</p>
					<RefreshButton :loading="serverStore.isLoadingFleet" @input="refresh" />
				</div>

				<p v-if="serverStore.fleetOverviewTruncated" class="mb-4 flex items-center text-sm text-yellow-2">
					<Icon icon="warning" color="text-yellow-2" size="4" svgStyle="mr-2" />
					Some servers took too long to answer. Refresh to try them again.
				</p>

				<p v-if="!fleet.length && !serverStore.isLoadingFleet" class="font-main text-gray-7">
					No servers available.
				</p>

				<div class="flex flex-wrap gap-4">
					<div
						v-for="instance in fleet"
						:key="instance.id"
						class="rounded-lg p-4 w-full sm:w-72 border border-gray-5 cursor-pointer hover:brightness-110"
						:class="instance.server?.online ? 'gradient-tile-green' : 'gradient-tile-red'"
						@click="openInstance(instance)"
					>
						<p class="font-main font-bold text-lg text-teal-4 break-all">{{ instance.name }}</p>

						<div class="mt-1 flex items-center">
							<Icon v-if="instance.missing" icon="warning" color="text-red-3" size="4" svgStyle="mr-1" />
							<p class="font-mono text-sm" :class="instance.missing ? 'text-red-3' : 'text-gray-7'">
								{{ instance.stateLabel }}
							</p>
						</div>

						<div class="mt-3 pt-3 border-t border-gray-5">
							<p class="font-main font-bold" :class="serverLineClass(instance)">
								{{ serverLineText(instance) }}
							</p>

							<template v-if="instance.server?.online">
								<div class="mt-2 font-main text-sm">
									<p class="text-gray-7">
										World: <span class="text-white-0">{{ instance.server.world || "—" }}</span>
									</p>
									<p class="text-gray-7">
										Players:
										<span class="text-white-0">
											{{ instance.server.playercount }}<template v-if="instance.server.maxplayers"> / {{ instance.server.maxplayers }}</template>
										</span>
									</p>
								</div>

								<div v-if="instance.roster.length" class="mt-2 flex flex-wrap gap-1">
									<span
										v-for="player in instance.roster"
										:key="player"
										class="rounded bg-gray-5 px-2 py-0.5 font-main text-xs text-teal-6"
									>{{ player }}</span>
								</div>
							</template>
						</div>

						<div v-if="instance.onlineSince" class="mt-3 font-main text-xs text-gray-7">
							<p>Instance uptime</p>
							<ActiveDate
								:date="instance.onlineSince"
								:type="ACTIVE_DATE_VARIANT.ELAPSED_COMPACT"
								class-name="text-white-0"
							/>
						</div>
					</div>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { useUserStore } from '../../../../stores/userStore';
import { ACTIVE_DATE_VARIANT, EC2_STATE_LABELS, EC2_STATE_MISSING } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import ActiveDate from '../../../common/ActiveDate.vue';
import RefreshButton from '../../../common/RefreshButton.vue';

/** How each `reachable` value from the backend reads on a card. */
const REACHABILITY_TEXT = {
	offline: "SERVER OFFLINE",
	timeout: "NO RESPONSE",
	error: "UNREACHABLE",
};

export default {
	components: {
		ActiveDate,
		RefreshButton,
	},
	data() {
		return {
			ACTIVE_DATE_VARIANT,
			PERMISSIONS,
			serverStore: useServerStore(),
			userStore: useUserStore(),
		}
	},
	computed: {
		/**
		 * Cards, pre-derived so the template holds no logic. The backend has already filtered this to
		 * instances the caller has resource access to, so there is no client-side filter here the way
		 * there is on the Instance and Server pickers.
		 */
		fleet() {
			return this.serverStore.fleetOverview.map((instance) => ({
				...instance,
				missing: instance.state === EC2_STATE_MISSING,
				stateLabel: instance.state === EC2_STATE_MISSING
					? "NOT FOUND IN EC2"
					: (EC2_STATE_LABELS[instance.state] || "UNKNOWN"),
				// Only meaningful while the box is up: EC2 keeps reporting the launch time of the last
				// run on a stopped instance, which would render as an uptime that never stopped rising.
				onlineSince: (instance.launchTime && instance.state === "running")
					? new Date(instance.launchTime)
					: null,
				roster: (instance.server?.players || []).map((player) => player?.nickname).filter(Boolean),
			}));
		},
		summaryText() {
			if (!this.fleet.length) return "NO SERVERS";

			// Counted over instances that reported a server block at all, so a caller without server
			// access sees an instance count rather than a misleading "0 / 3 ONLINE".
			const withServer = this.fleet.filter((instance) => instance.server);
			if (!withServer.length) {
				return `${this.fleet.length} INSTANCE${this.fleet.length === 1 ? "" : "S"}`;
			}

			const online = withServer.filter((instance) => instance.server.online);
			const players = online.reduce((total, instance) => total + (instance.server.playercount || 0), 0);
			return `${online.length} / ${this.fleet.length} ONLINE · ${players} PLAYER${players === 1 ? "" : "S"}`;
		},
	},
	methods: {
		serverLineText(instance) {
			if (!instance.server) {
				// Either the instance isn't running or the caller can't read servers. Both are a
				// deliberate absence rather than a failure, so neither claims the server is down.
				return "NO SERVER";
			}
			if (instance.server.online) return "SERVER ONLINE";
			return REACHABILITY_TEXT[instance.server.reachable] || "SERVER OFFLINE";
		},
		serverLineClass(instance) {
			// The tile's gradient already carries green/red, same as ServerState.vue - so the text
			// only breaks from teal for the states the background can't express on its own.
			if (!instance.server) return "text-gray-7";
			if (instance.server.online) return "text-teal-4";
			return instance.server.reachable === "offline" ? "text-red-5" : "text-yellow-2";
		},
		/** Selects the clicked instance and hands off to whichever page the user can actually use. */
		openInstance(instance) {
			this.serverStore.selectInstance(instance.id);
			this.$router.push(this.$checkPermissions(PERMISSIONS.server.status.read) ? "/server" : "/instance");
		},
		async refresh() {
			try {
				await this.serverStore.fetchFleetOverview();
			} catch (e) {
				console.error(e);
				this.$alert.error("Error fetching servers");
			}
		},
	},
	mounted() {
		// Guarded rather than unconditional: Overview is routed at "/" as well as "/overview", and "/"
		// is requiresAuth: false, so this component also renders for signed-out visitors landing on the
		// public page (and on every Cognito sign-in redirect). An unguarded fetch would 401 there.
		if (!this.userStore.isAuthenticated) return;
		if (!this.$checkPermissions(PERMISSIONS.instance.list)) return;

		this.refresh();
	},
}
</script>

<style scoped>

</style>
