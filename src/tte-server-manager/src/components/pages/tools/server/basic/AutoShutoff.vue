<template>
	<div>
		<StatusTile
			class="grow gradient-tile"
			collapsible
			:floatingExpand="!isMobile"
			:perm-required="PERMISSIONS.server.status.read"
			:loading="loading"
		>
			<template #header>
				<Icon icon="moon" color="text-gray-6" size="5" class="-mt-0.5" />
				<p class="text-gray-6 ml-1 text-lg">Auto Shutoff</p>
			</template>
			<template #summary>
				<ActiveDate
					v-if="shutoffIsScheduled"
					:type="ACTIVE_DATE_VARIANT.COUNTDOWN"
					:date="shutoffScheduledFor"
					class="font-main font-bold text-teal-4 text-2xl"
					@countdownExpired="refreshStatus"
				/>
				<p v-else class="text-2xl text-teal-4">{{ summaryText }}</p>
			</template>
			<template #content>
				<div v-if="shutoffIsScheduled" class="font-main font-bold px-4 mb-4 text-gray-8">
					Shutoff scheduled for: <span class="text-teal-4">{{ shutoffScheduledForReadable }}</span>
				</div>
				<div v-if="shutoffIsPaused" class="font-main font-bold px-4 mb-4 text-gray-8">
					Shutoff paused until:
					<p class="text-teal-4">{{ pausedUntilReadable }}</p>
				</div>
				<div>
					<FlexButton
						v-if="shutoffIsScheduled"
						class="mx-4 mb-4"
						:disabled="loading"
						:variant="BTN_VARIANT.DANGER"
						@input="cancelShutoff"
					>
						<p class="py-2 px-12">CANCEL AUTO SHUTOFF</p>
					</FlexButton>
					<FlexButton
						class="mx-4 mb-4"
						:disabled="loading"
						:variant="BTN_VARIANT.SECONDARY"
						@input="pauseUntilPickerOpen = true"
					>
						CUSTOM SHUTOFF PAUSE
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<DateTimePickerPopup
			:open="pauseUntilPickerOpen"
			headerText="Pause auto-shutoff until"
			@cancel="pauseUntilPickerOpen = false; pauseUntilValue = null"
			@close="pauseShutoff"
			v-model="pauseUntilValue"
		>
			<div class="flex justify-center">
				<FlexButton
					v-if="shutoffIsPaused"
					class="mx-4 mb-4"
					:disabled="loading"
					:variant="BTN_VARIANT.SECONDARY"
					@input="clearPause"
				>
					CLEAR SHUTOFF PAUSE
				</FlexButton>
			</div>
		</DateTimePickerPopup>
	</div>
</template>

<script>
import ActiveDate from '@/components/common/ActiveDate.vue';
import DateTimePickerPopup from '@/components/common/DateTimePickerPopup.vue';
import FlexButton from '@/components/common/FlexButton.vue';
import { useServerStore } from '@/stores/serverStore';
import { post } from '@/util/api';
import { ACTIVE_DATE_VARIANT, BTN_VARIANT } from '@/util/constants';
import delay from '@/util/delay';
import { PERMISSIONS } from '@/util/permissionValues';


export default {
	mixins: [],
	components: {
		ActiveDate,
		DateTimePickerPopup,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			ACTIVE_DATE_VARIANT,
			serverStore: useServerStore(),
			pauseUntilPickerOpen: false,
			pauseUntilValue: null,
			loading: false,
		}
	},
	computed: {
		selectedServerData() {
			return this.serverStore.selectedServerData;
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		shutoffIsScheduled() {
			return Boolean(this.selectedServerData?.autoShutoff?.scheduledShutdownAt);
		},
		shutoffIsPaused() {
			return Boolean(this.selectedServerData?.autoShutoff?.pauseUntilAt) && (this.selectedServerData?.autoShutoff?.pauseUntilAt > Date.now());
		},
		summaryText() {
			if (this.selectedServerData?.autoShutoff?.sequenceStage === "shutdown") {
				return "Shutting down";
			}
			if (this.shutoffIsPaused) {
				return "Paused";
			}
			if (!this.selectedServerData.state) {
				return "Inactive";
			}
			return "Not scheduled";
		},
		shutoffScheduledFor() {
			return new Date(this.selectedServerData.autoShutoff.scheduledShutdownAt);
		},
		shutoffScheduledForReadable() {
			return this.shutoffIsScheduled
				? new Date(this.selectedServerData.autoShutoff.scheduledShutdownAt).toLocaleString(undefined, { hour: "numeric", minute: "numeric" })
				: "";
		},
		pausedUntilReadable() {
			return this.shutoffIsPaused
				? new Date(this.selectedServerData.autoShutoff.pauseUntilAt).toLocaleString(undefined, { 
					weekday: "short",
					year: "numeric",
					month: "long",
					day: "numeric",
					hour: "numeric",
					minute: "numeric",
				})
				: "";
		}
	},
	methods: {
		async pauseShutoff() {
			this.pauseUntilPickerOpen = false;

			this.$validatePermissions(PERMISSIONS.server.status.start);

			if (this.loading) return;
			this.loading = true;

			try {
				await post("/system/autoshutoff/pause", PERMISSIONS.server.status.start, {
					serverId: this.selectedInstance,
					pauseUntilAt: Date.parse(this.pauseUntilValue)
				});
				const dateStr = new Date(this.pauseUntilValue).toLocaleString(undefined, {
					weekday: "short",
					year: "numeric",
					month: "long",
					day: "numeric",
					hour: "numeric",
					minute: "numeric",
				});
				this.$alert.success("Shutoff paused until " + dateStr);
			} catch (e) {
				this.$alert.error("Failed to pause shutoff");
			} finally {
				this.loading = false;
				this.serverStore.fetchServerStatus(this.selectedInstance);
			}
		},
		async clearPause() {
			this.pauseUntilPickerOpen = false;

			this.$validatePermissions(PERMISSIONS.server.status.start);

			if (this.loading) return;
			this.loading = true;

			try {
				await post("/system/autoshutoff/pause", PERMISSIONS.server.status.start, {
					serverId: this.selectedInstance,
					pauseUntilAt: null
				});
				this.$alert.success("Shutoff pause cleared");
			} catch (e) {
				this.$alert.error("Failed to clear auto-shutoff pause");
			} finally {
				this.loading = false;
				this.serverStore.fetchServerStatus(this.selectedInstance);
			}
		},
		async cancelShutoff() {
			this.pauseUntilPickerOpen = false;

			this.$validatePermissions(PERMISSIONS.server.status.start);

			if (this.loading) return;
			this.loading = true;

			try {
				await post("/system/autoshutoff/cancel", PERMISSIONS.server.status.start, {
					serverId: this.selectedInstance,
				});
				this.$alert.success("Auto shutoff canceled");
			} catch (e) {
				this.$alert.error("Failed to cancel auto shutoff");
			} finally {
				this.loading = false;
				this.serverStore.fetchServerStatus(this.selectedInstance);
			}
		},
		async refreshStatus() {
			await delay(2000);
			await this.serverStore.fetchServerStatus(this.selectedInstance);
		}
	},
}
</script>

<style scoped>

</style>
