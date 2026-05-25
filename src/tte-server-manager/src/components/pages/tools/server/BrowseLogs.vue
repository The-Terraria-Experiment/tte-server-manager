<template>
	<div>
		<StatusTile
			class="grow mt-2 gradient-tile"
			:perm-required="PERMISSIONS.server.logs.read"
			:loading="loading"
		>
			<template #header>
				<Icon icon="file-lines" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Player Logs</p>
			</template>
			<!-- <template #summary>
				<p class="text-2xl text-teal-4">Logs available</p>
			</template> -->
			<template #content>
				<div class="px-4 pb-4">
					<div class="">
						<div class="flex flex-wrap gap-2 items-center">
							<Dropdown
								class="sm:max-w-1/4"
								inputClass="bg-teal-3 text-white-1"
								iconColor="text-white-1"
								:options="filterByOptions"
								v-model="logsFilter"
							/>
		
							<div class="py-1 pl-3 pr-1 bg-gray-2 rounded-md font-main font-bold text-white-0 flex items-center">
								<p>From:</p>
								<div
									@click="timeFilterStartPopupOpen = true"
									class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
								>
									<p class="mr-2">{{ timeFilterStart || 'forever ago' }}</p>
									<Icon icon="edit" color="text-white-1" size="5" />
								</div>
							</div>
							<div class="py-1 pl-3 pr-1 bg-gray-2 rounded-md font-main font-bold text-white-0 flex items-center">
								<p>To:</p>
								<div
									@click="timeFilterEndPopupOpen = true"
									class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
								>
									<p class="mr-2">{{ timeFilterEnd || 'now' }}</p>
									<Icon icon="edit" color="text-white-1" size="5" />
								</div>
							</div>

							<FlexButton
								class=""
								:variant="BTN_VARIANT.SECONDARY"
								leftIcon="clock"
								leftIconSize="4"
								:disabled="loadingActiveSession"
								:loading="loadingActiveSession"
								@input="detectRunningSession"
							>
								DETECT ACTIVE SESSION
							</FlexButton>
							
						</div>
						<div v-if="logsFilter === FILTER.EVENT" class="flex flex-wrap gap-2 mt-2">
							<template v-for="(eventName, eventCode) in EVENT_NAMES">
								<div
									class="flex items-center bg-blue-0 px-2 py-1 rounded-md cursor-pointer hover:bg-blue-1"
									@click="eventFilter.has(eventCode) ? eventFilter.delete(eventCode) : eventFilter.add(eventCode)"
								>
									<Checkbox
										class="h-4 w-4"
										:value="eventFilter.has(eventCode)"
									/>
									<span class="ml-2 font-main font-bold text-white-1">
										{{ eventName }}
									</span>
								</div>
							</template>
						</div>
						<div v-if="logsFilter === FILTER.PLAYER" class="mt-2">
							<ValueInput v-model="playerFilter" placeholder="Player username" />
						</div>
						<FlexButton
							:title="sameQuery ? 'This query is already loaded' : ''"
							class="mt-4"
							:variant="BTN_VARIANT.SECONDARY"
							leftIcon="cloud-download"
							leftIconSize="5"
							:disabled="loading || sameQuery"
							:loading="loading"
							@input="fetchInitial"
						>
							FETCH LOGS
						</FlexButton>
					</div>
					<div v-if="queryWasRun" class="mt-4">
						<p class="font-main font-bold text-gray-8">{{ logs.length }} log entries currently loaded</p>
						<FlexButton
							v-if="logs.length > 0"
							class="mt-2"
							:variant="BTN_VARIANT.SECONDARY"
							leftIcon="external"
							leftIconSize="4"
							@input="logViewPopupOpen = true"
						>
							VIEW LOGS
						</FlexButton>
					</div>
				</div>
			</template>
		</StatusTile>

		<Popup
			headerText="VIEW LOGS"
			bodyClass="h-11/12 w-11/12"
			:open="logViewPopupOpen"
			@xClicked="logViewPopupOpen = false"
		>
			<div class="px-4 pb-4 flex flex-col h-full">
				<p class="my-2 text-gray-6 font-bold italic">Dates and times are displayed in your time zone</p>
				<div class="grid log-grid text-white-0 font-mono text-sm overflow-auto relative">
					<div class="text-white-0 p-1 text-md font-bold bg-teal-1 sticky top-0">Timestamp</div>
					<div class="text-white-0 p-1 text-md font-bold bg-teal-1 sticky top-0">Username</div>
					<div class="text-white-0 p-1 text-md font-bold bg-teal-1 sticky top-0">Event</div>
					<div class="text-white-0 p-1 text-md font-bold bg-teal-1 sticky top-0">World</div>
					<div class="text-white-0 p-1 text-md font-bold bg-teal-1 sticky top-0">Player Group</div>
					<div class="text-white-0 p-1 text-md font-bold bg-teal-1 sticky top-0">TShock Login</div>
					<div class="text-white-0 p-1 text-md font-bold bg-teal-1 sticky top-0">Players Online</div>
					<template v-for="(log, i) in currentLogsPage">
						<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ new Date(log.timestamp).toLocaleString() }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ log.playerName }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ log.eventType }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ log.worldName }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ log.playerGroup }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ log.isLoggedIn }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ log.playersActive }}</div>
					</template>
				</div>
				<div class="flex items-center mt-4">
					<FlexButton
						class="px-2!"
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="chevron-left"
						leftIconSize="5"
						:disabled="loading || logsPage === 0"
						@input="previousPage"
					/>
					<p class="font-main font-bold mx-2 text-white-0 text-sm sm:text-md">
						Showing {{ logsPage * logPageSize }} to {{ Math.min((logsPage + 1) * logPageSize, logs.length) }}
						of {{ logs.length }} loaded entries
						({{ lastFetchedLog ? '' : 'no ' }}more available)
					</p>
					<FlexButton
						class="px-2!"
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="chevron-right"
						leftIconSize="5"
						:disabled="loading || (((logsPage + 1) * logPageSize) >= logs.length && !lastFetchedLog)"
						@input="nextPage"
					/>
				</div>
			</div>
		</Popup>

		<DateTimePickerPopup
			:open="timeFilterStartPopupOpen"
			@close="timeFilterStartPopupOpen = false"
			@cancel="timeFilterStartPopupOpen = false; timeFilterStart = null;"
			v-model="timeFilterStart"
		/>
		<DateTimePickerPopup
			:open="timeFilterEndPopupOpen"
			@close="timeFilterEndPopupOpen = false"
			@cancel="timeFilterEndPopupOpen = false; timeFilterEnd = null;"
			v-model="timeFilterEnd"
		/>
	</div>
</template>

<script>
import Checkbox from '@/components/common/Checkbox.vue';
import DateTimePickerPopup from '@/components/common/DateTimePickerPopup.vue';
import Dropdown from '@/components/common/Dropdown.vue';
import FlexButton from '@/components/common/FlexButton.vue';
import Icon from '@/components/common/Icon.vue';
import Popup from '@/components/common/Popup.vue';
import ValueInput from '@/components/common/ValueInput.vue';
import { useServerStore } from '@/stores/serverStore';
import { post } from '@/util/api';
import { BTN_VARIANT } from '@/util/constants';
import { deepObjsEqual } from '@/util/equality';
import { PERMISSIONS } from '@/util/permissionValues';

const FILTER = {
	ALL: "all",
	PLAYER: "player",
	EVENT: "event"
};

const EVENT = {
	PJOIN: "player.join",
	PLEAVE: "player.leave",
	PCHAT: "player.chat",
	PDEATH: "player.death",
	PSPAWN: "player.spawn",
	WSAVE: "world.save",
	WRELOAD: "server.reload",
};

const EVENT_NAMES = {
	[EVENT.PJOIN]: "Player join",
	[EVENT.PLEAVE]: "Player leave",
	// [EVENT.PCHAT]: "Player chat",
	[EVENT.PDEATH]: "Player death",
	[EVENT.PSPAWN]: "Player (re)spawn",
	// [EVENT.WSAVE]: "World save",
	// [EVENT.WRELOAD]: "Server reload",
};

export default {
	mixins: [],
	components: {
		Dropdown,
		DateTimePickerPopup,
		Checkbox,
		ValueInput,
		FlexButton,
		Popup,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			FILTER,
			EVENT_NAMES,
			BTN_VARIANT,

			serverStore: useServerStore(),

			filterByOptions: [
				{ id: FILTER.ALL, text: "All logs" },
				{ id: FILTER.PLAYER, text: "Specific player" },
				{ id: FILTER.EVENT, text: "Specific event type" }
			],
			logsFilter: FILTER.ALL,
			timeFilterStart: null,
			timeFilterEnd: null,
			eventFilter: new Set([EVENT.PJOIN, EVENT.PLEAVE, EVENT.PDEATH, EVENT.PSPAWN]),
			playerFilter: "",
			timeFilterStartPopupOpen: false,
			timeFilterEndPopupOpen: false,
			logViewPopupOpen: false,
			loading: false,
			loadingActiveSession: false,

			logPageSize: 50,
			logs: [],
			logsPage: 0,
			lastFetchedLog: undefined,
			queryWasRun: false,

			lastQuery: null
		}
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		selectedServerData() {
			return this.serverStore.selectedServerData;
		},
		queryParams() {
			const params = {
				lastValue: this.lastFetchedLog || null,
				startTime: this.timeFilterStart ? Date.parse(this.timeFilterStart) : null,
				endTime: this.timeFilterEnd ? Date.parse(this.timeFilterEnd) : null,
				player: this.logsFilter === FILTER.PLAYER ? this.playerFilter : null,
			};

			if (this.logsFilter === FILTER.EVENT) {
				if (this.eventFilter.size === 1) {
					params.eventType = Array.from(this.eventFilter.values())[0];
				} else {
					params.eventTypes = Array.from(this.eventFilter);
				}
			} else {
				params.eventType = null;
			}

			return params;
		},
		sameQuery() {
			return deepObjsEqual(this.queryParams, this.lastQuery);
		},
		currentLogsPage() {
			return this.logs.slice(this.logsPage * this.logPageSize, (this.logsPage + 1) * this.logPageSize);
		}
	},
	methods: {
		async fetchInitial() {
			await this.$validatePermissions(PERMISSIONS.server.logs.read);

			if (this.loading) return;

			this.logs = [];
			this.lastFetchedLog = null;
			this.logsPage = 0;
			const success = await this.fetchLogs();
			this.queryWasRun = true;
			this.logViewPopupOpen = true;

			if (success) {
				this.lastQuery = this.queryParams;
			}
		},
		async fetchLogs() {
			await this.$validatePermissions(PERMISSIONS.server.logs.read);

			if (this.loading) return;

			if (this.logsFilter === FILTER.EVENT && !this.eventFilter.size) {
				this.$alert.warning("Please select at least one event type");
				return;
			}
			if (this.logsFilter === FILTER.PLAYER && !this.queryParams.player) {
				this.$alert.warning("Please enter a full player username");
				return;
			}
			if (this.queryParams.startTime && this.queryParams.endTime && this.queryParams.startTime > this.queryParams.endTime) {
				this.$alert.warning("The 'from' time must be before the 'to' time");
				return;
			}

			this.loading = true;

			try {
				const result = await post(`/logging/${this.selectedInstance}/fetch`, PERMISSIONS.server.logs.read, this.queryParams);
				this.logs.push(...result.entries);
				this.lastFetchedLog = result.lastValue;
				return true;
			} catch (e) {
				this.$alert.error("Failed to fetch logs");
				console.error(e);
				return false;
			} finally {
				this.loading = false;
			}
		},
		previousPage() {
			if (this.logsPage === 0) return;
			this.logsPage = this.logsPage - 1;
		},
		async nextPage() {
			if ((this.logsPage + 1) * this.logPageSize >= this.logs.length) {
				if (this.lastFetchedLog) {
					const success = await this.fetchLogs();
					if (!success) {
						return;
					}
				} else {
					return;
				}
			}

			this.logsPage = this.logsPage + 1;
		},
		async detectRunningSession() {
			await this.$validatePermissions(PERMISSIONS.server.logs.read);

			if (this.loadingActiveSession) return;
			this.loadingActiveSession = true;

			try {
				await this.serverStore.fetchServerStatus(this.selectedInstance);
				const uptime = this.selectedServerData.uptime ?? "";

				const timeRegex = /^(\d+)\.(\d{2}):(\d{2}):(\d{2}$)/gm;
				if (!uptime || !uptime.match(timeRegex)) {
					this.$alert.error("Invalid session duration. Could not detect session.");
					return;
				}

				const results = timeRegex.exec(uptime);
				const [full, days, hours, minutes, seconds] = results; // not entirely sure that the first number is days, I've never had a session get long enough for it to be not 0

				const totalInSec = (parseInt(days) * 24 * 60 * 60) + (parseInt(hours) * 60 * 60) + (parseInt(minutes) * 60) + parseInt(seconds);
				const sessionStart = Date.now() - (totalInSec * 1000) - (60 * 1000); // plus one minute of grace

				this.timeFilterStart = new Date(sessionStart).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
			} catch (e) {
				this.$alert.error("Failed to detect session");
			} finally {
				this.loadingActiveSession = false;
			}
		}
	},
}
</script>

<style scoped>
.log-grid {
	grid-template-columns: repeat(7, minmax(max-content, 1fr));
}
</style>
