<template>
	<StatusTile
		v-if="publicAddress?.configured"
		class="grow gradient-tile mt-2"
		collapsible
		:perm-required="PERMISSIONS.instance.list"
		:loading="loading"
	>
		<template #header>
			<Icon icon="network" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Public Address</p>
		</template>
		<template #summary>
			<p :class="['text-2xl truncate', isTarget ? 'text-teal-4' : 'text-gray-8']">
				{{ isTarget ? "Live here" : "Not here" }}
			</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<div class="bg-gray-2 rounded-md p-4">
					<p class="font-mono text-white-0 break-all">{{ publicAddress.hostname || "The public address" }}</p>

					<p v-if="publicAddress.mixed" class="font-mono text-sm text-yellow-2 mt-2">
						Split across {{ publicAddress.targets.length }} servers ({{ targetNames }}). Routing here sends everything to this one.
					</p>
					<p v-else-if="isTarget" class="font-mono text-sm text-teal-4 mt-2">
						Points at this instance.
						<span v-if="targetHealth === 'UNHEALTHY'" class="text-gray-7">No server is answering yet, so players can't join until one is launched.</span>
					</p>
					<p v-else-if="publicAddress.targetInstanceId" class="font-mono text-sm text-gray-8 mt-2">
						Points at {{ targetNames }}. Players using this address won't reach this instance.
					</p>
					<p v-else class="font-mono text-sm text-yellow-2 mt-2">Doesn't point at any instance.</p>
				</div>

				<div v-if="canRoute && !isTarget" class="flex items-center justify-end mt-4">
					<p class="font-mono text-xs text-gray-7 mr-3 text-right">
						Affects prod and stage. Anyone on the current server is disconnected.
					</p>
					<FlexButton
						:variant="BTN_VARIANT.PRIMARY"
						leftIcon="network"
						:loading="routing"
						:disabled="routing || isShuttingDown"
						@input="route(false)"
					>
						ROUTE HERE
					</FlexButton>
				</div>
			</div>
		</template>
	</StatusTile>

	<Popup
		body-class="h-1/3 w-11/12 sm:w-1/2 lg:w-1/4"
		header-text="PLAYERS CONNECTED"
		:open="Boolean(pendingConfirm)"
		@x-clicked="pendingConfirm = null"
		:buttons="[
			{ variant: BTN_VARIANT.PRIMARY, text: 'CANCEL', onClick: () => { pendingConfirm = null } },
			{ variant: BTN_VARIANT.DANGER, text: 'SWITCH ANYWAY', onClick: () => route(true) },
		]"
	>
		<div class="p-4 h-full w-full flex flex-col text-center justify-center items-center font-main font-bold">
			<p class="text-white-0 py-2">{{ pendingConfirm }}</p>
			<p class="text-red-5">Switching will disconnect them.</p>
		</div>
	</Popup>
</template>

<script>
import { useServerStore } from '@/stores/serverStore';
import { BTN_VARIANT } from '@/util/constants';
import { PERMISSIONS } from '@/util/permissionValues';
import FlexButton from '@/components/common/FlexButton.vue';
import Popup from '@/components/common/Popup.vue';

/**
 * Where the public play address (a Global Accelerator in front of the fleet) points, and the control
 * to point it at this instance. Global Accelerator itself is the source of truth; nothing here is
 * cached beyond the store's copy, which the `instance.publicaddress` socket event refreshes.
 */
export default {
	components: {
		FlexButton,
		Popup,
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			loading: false,
			routing: false,
			/** The server's "N players connected" message while a forced switch awaits confirmation. */
			pendingConfirm: null,
		};
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		publicAddress() {
			return this.serverStore.publicAddress;
		},
		isTarget() {
			return Boolean(this.publicAddress?.targetInstanceId) && this.publicAddress.targetInstanceId === this.selectedInstance;
		},
		targetHealth() {
			return this.publicAddress?.targets?.find(t => t.instanceId === this.selectedInstance)?.healthState ?? null;
		},
		targetNames() {
			return (this.publicAddress?.targets ?? []).map(t => t.name || t.instanceId).join(", ");
		},
		canRoute() {
			return this.$checkPermissions(PERMISSIONS.instance.publicaddress.write);
		},
		isShuttingDown() {
			return this.serverStore.isShuttingDown(this.selectedInstance);
		},
	},
	methods: {
		async refresh() {
			this.loading = true;
			try {
				await this.serverStore.fetchPublicAddress();
			} catch (e) {
				console.error("Error reading public address:", e);
			} finally {
				this.loading = false;
			}
		},
		async route(force) {
			if (this.routing) return;
			this.pendingConfirm = null;
			this.routing = true;
			try {
				const result = await this.serverStore.routePublicAddress(this.selectedInstance, force);
				this.$alert.success(result?.changed === false
					? "The public address already points here"
					: "The public address now points at this instance");
			} catch (e) {
				if (e?.code === "PLAYERS_CONNECTED") {
					this.pendingConfirm = e.message;
				} else {
					this.$alert.error(e?.message || "Error switching the public address");
				}
			} finally {
				this.routing = false;
			}
		},
	},
	mounted() {
		this.refresh();
	},
};
</script>
