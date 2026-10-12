<template>
	<StatusTile
		v-if="supported"
		class="grow gradient-tile mt-2"
		collapsible
		:perm-required="PERMISSIONS.instance.tmodloader.update"
		:loading="loading"
	>
		<template #header>
			<Icon icon="cloud-download" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">tModLoader Version</p>
		</template>
		<template #summary>
			<p :class="['text-2xl truncate', summaryClass]">{{ summary }}</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<div class="bg-gray-2 rounded-md p-4 font-mono text-sm">
					<div class="flex justify-between items-start gap-4">
						<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
							<p class="text-gray-7">Installed</p>
							<p class="text-white-0">{{ installedLabel }}</p>
							<p class="text-gray-7">Latest stable</p>
							<p class="text-white-0">
								{{ status?.latest?.version || "unknown" }}
								<span v-if="status?.latest?.publishedAt" class="text-gray-7">({{ formatDate(status.latest.publishedAt) }})</span>
							</p>
							<p class="text-gray-7">Fleet release</p>
							<p class="text-white-0">{{ status?.mirrored?.version || (status?.mirrored ? "uploaded by hand" : "none") }}</p>
						</div>
						<RefreshButton :variant="BTN_VARIANT.SECONDARY" :disabled="loading" @input="refresh" />
					</div>

					<p v-if="status?.latestError" class="text-yellow-2 mt-3">{{ status.latestError }}</p>
					<p v-if="status?.boxError" class="text-yellow-2 mt-3">{{ status.boxError }}</p>
					<p v-if="status && !instanceRunning" class="text-gray-8 mt-3">Start the instance to check or change its install.</p>
					<p v-else-if="status?.box?.serverRunning && !jobActive" class="text-gray-8 mt-3">Stop the game server to update or roll back.</p>
				</div>

				<div v-if="job" class="bg-gray-2 rounded-md p-4 mt-2 font-mono text-sm">
					<template v-if="jobActive">
						<p class="text-white-0">{{ job.detail || "Updating" }}</p>
						<div class="h-2 bg-gray-4 rounded mt-2 overflow-hidden">
							<div class="h-full bg-teal-4 transition-all" :style="{ width: `${job.progress}%` }"></div>
						</div>
						<p class="text-gray-7 mt-2">Started by {{ job.requestedBy || "someone" }}. You can leave this page; launches are blocked until it finishes.</p>
					</template>
					<template v-else-if="job.status === 'failed' || job.abandoned">
						<p class="text-red-5">Update {{ job.targetVersion ? `to ${job.targetVersion} ` : "" }}failed</p>
						<p class="text-gray-8 mt-1">{{ job.failureReason || "The update stopped reporting progress." }}</p>
					</template>
					<template v-else-if="job.status === 'completed'">
						<p class="text-teal-4">
							{{ job.result === "up-to-date" ? `Already on ${job.targetVersion}` : `Installed ${job.targetVersion}` }}
							<span v-if="job.fromVersion" class="text-gray-7">(was {{ job.fromVersion }})</span>
						</p>
						<p v-if="job.result !== 'up-to-date'" class="text-gray-8 mt-1">
							Launch a world to use it. If the server doesn't come up or the site can't manage it, our mods may not
							work with this release yet. Roll back to get the server running again.
						</p>
					</template>
				</div>

				<div v-if="instanceRunning" class="flex flex-wrap items-center justify-end gap-2 mt-4">
					<FlexButton
						v-if="status?.box?.previousAvailable"
						:variant="BTN_VARIANT.SECONDARY"
						:disabled="!canAct || busy"
						@input="confirm = 'rollback'"
					>
						<p class="font-main font-bold py-2 px-8">{{ rollingBack ? "ROLLING BACK..." : "ROLL BACK" }}</p>
					</FlexButton>
					<FlexButton
						:variant="BTN_VARIANT.PRIMARY"
						:disabled="!canAct || busy || !status?.latest || status?.upToDate === true"
						@input="confirm = 'update'"
					>
						<p class="font-main font-bold py-2 px-8">{{ updateButtonLabel }}</p>
					</FlexButton>
				</div>
			</div>
		</template>
	</StatusTile>

	<Popup
		body-class="h-1/3 w-11/12 sm:w-1/2 lg:w-1/3"
		:header-text="confirm === 'rollback' ? 'ROLL BACK TMODLOADER' : 'UPDATE TMODLOADER'"
		:open="Boolean(confirm)"
		@x-clicked="confirm = null"
		:buttons="[
			{ variant: BTN_VARIANT.SECONDARY, text: 'CANCEL', onClick: () => { confirm = null } },
			{ variant: BTN_VARIANT.PRIMARY, text: confirm === 'rollback' ? 'ROLL BACK' : 'UPDATE', onClick: () => confirm === 'rollback' ? rollback() : update() },
		]"
	>
		<div class="p-4 h-full w-full flex flex-col text-center justify-center items-center font-main font-bold">
			<template v-if="confirm === 'rollback'">
				<p class="text-white-0 py-2">Switch this instance back to {{ status?.box?.previousVersion || "the previous install" }}?</p>
				<p class="text-gray-8">Only this instance changes. The next update reinstalls the fleet release.</p>
			</template>
			<template v-else>
				<p class="text-white-0 py-2">Install {{ status?.latest?.version }} on this instance?</p>
				<p class="text-yellow-2">This also makes it the release every tModLoader instance installs, in prod and stage.</p>
			</template>
		</div>
	</Popup>
</template>

<script>
import { useServerStore } from '@/stores/serverStore';
import { BTN_VARIANT } from '@/util/constants';
import { PERMISSIONS } from '@/util/permissionValues';
import FlexButton from '@/components/common/FlexButton.vue';
import Popup from '@/components/common/Popup.vue';
import RefreshButton from '@/components/common/RefreshButton.vue';

/** How often the job row is re-read while an update runs. The cheap `?fields=job` read, no SSM. */
const JOB_POLL_MS = 3000;

/**
 * Updates tModLoader on this instance to the latest stable release, or rolls it back. Only shown for
 * flavors with the `loaderUpdate` capability. The work runs as a backend job, so this tile only polls
 * it, and a remount picks the poll back up from the status read.
 */
export default {
	components: {
		FlexButton,
		Popup,
		RefreshButton,
	},
	props: {
		selectedInstanceData: {
			type: Object,
			required: true,
		},
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			status: null,
			loading: false,
			updating: false,
			rollingBack: false,
			/** `'update'` or `'rollback'` while its confirmation is open. */
			confirm: null,
			pollTimer: null,
		};
	},
	computed: {
		instanceId() {
			return this.selectedInstanceData.id;
		},
		supported() {
			return this.serverStore.serverFlavor(this.instanceId).capabilities.has("loaderUpdate");
		},
		job() {
			return this.status?.job || null;
		},
		jobActive() {
			return Boolean(this.job?.active);
		},
		instanceRunning() {
			return this.status?.instanceState === "running";
		},
		busy() {
			return this.updating || this.rollingBack || this.jobActive;
		},
		canAct() {
			return this.instanceRunning &&
				Boolean(this.status?.box) &&
				!this.status?.box?.serverRunning &&
				!this.serverStore.isShuttingDown(this.instanceId);
		},
		installedLabel() {
			const box = this.status?.box;
			if (!box) return this.instanceRunning ? "unknown" : "instance stopped";
			if (!box.installed) return "not installed";
			return box.version || "unknown version";
		},
		summary() {
			if (!this.status) return "Checking...";
			if (this.jobActive) return `Updating... ${this.job.progress}%`;
			if (this.status.upToDate === true) return `Up to date (${this.status.latest.version})`;
			if (this.status.upToDate === false) return `Update available: ${this.status.latest.version}`;
			if (!this.instanceRunning) return "Instance stopped";
			return this.status.box?.version || "Unknown version";
		},
		summaryClass() {
			if (this.status?.upToDate === false) return "text-yellow-2";
			if (this.status?.upToDate === true || this.jobActive) return "text-teal-4";
			return "text-gray-8";
		},
		updateButtonLabel() {
			if (this.updating || this.jobActive) return "UPDATING...";
			if (this.status?.upToDate === true) return "UP TO DATE";
			return this.status?.latest ? `UPDATE TO ${this.status.latest.version}` : "UPDATE";
		},
	},
	methods: {
		formatDate(iso) {
			return new Date(iso).toLocaleDateString();
		},
		async refresh() {
			if (!this.supported || !this.$checkPermissions(PERMISSIONS.instance.tmodloader.update)) return;
			this.loading = true;
			try {
				this.status = await this.serverStore.fetchTModLoaderStatus(this.instanceId);
				this.syncPolling();
			} catch (e) {
				console.error("Error reading tModLoader status:", e);
				this.$alert.error(e?.message || "Error reading tModLoader status");
			} finally {
				this.loading = false;
			}
		},
		syncPolling() {
			if (this.jobActive && !this.pollTimer) {
				this.pollTimer = setInterval(this.pollJob, JOB_POLL_MS);
			} else if (!this.jobActive && this.pollTimer) {
				this.stopPolling();
			}
		},
		stopPolling() {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		},
		async pollJob() {
			try {
				const { job } = await this.serverStore.fetchTModLoaderStatus(this.instanceId, { jobOnly: true });
				this.status = { ...this.status, job };
				if (!job?.active) {
					this.stopPolling();
					// The full read again, so the installed version and rollback availability catch up.
					await this.refresh();
				}
			} catch (e) {
				// A blip in a background poll isn't worth a sticky alert. The next tick retries.
				console.warn("Error polling tModLoader update:", e);
			}
		},
		async update() {
			this.confirm = null;
			if (this.busy) return;
			this.updating = true;
			try {
				const result = await this.serverStore.updateTModLoader(this.instanceId);
				this.status = { ...this.status, job: result.job };
				this.syncPolling();
			} catch (e) {
				this.$alert.error(e?.message || "Error starting the tModLoader update");
			} finally {
				this.updating = false;
			}
		},
		async rollback() {
			this.confirm = null;
			if (this.busy) return;
			this.rollingBack = true;
			try {
				const result = await this.serverStore.rollbackTModLoader(this.instanceId);
				this.$alert.success(`Rolled back to ${result.version || "the previous install"}`);
				await this.refresh();
			} catch (e) {
				this.$alert.error(e?.message || "Error rolling back tModLoader");
			} finally {
				this.rollingBack = false;
			}
		},
	},
	watch: {
		// The tile mounts before the instance list says which flavor this is, and the instance may be
		// started while it's open. Either change is worth a fresh read.
		supported(value) {
			if (value) this.refresh();
		},
		"selectedInstanceData.state"(value, old) {
			if (value === "ONLINE" && old !== "ONLINE") this.refresh();
		},
	},
	mounted() {
		this.refresh();
	},
	beforeUnmount() {
		this.stopPolling();
	},
};
</script>
