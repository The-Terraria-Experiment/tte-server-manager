<template>
	<div>
		<StatusTile
			class="grow gradient-tile"
			:perm-required="PERMISSIONS.server.logs.players.read"
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
								v-model="logState.logsFilter"
							/>

							<div class="py-1 pl-3 pr-1 bg-gray-2 rounded-md font-main font-bold text-white-0 flex items-center">
								<p>From:</p>
								<div
									@click="timeFilterStartPopupOpen = true"
									class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
								>
									<p class="mr-2">{{ logState.timeFilterStart ? new Date(logState.timeFilterStart).toLocaleString() : 'forever ago' }}</p>
									<Icon icon="edit" color="text-white-1" size="5" />
								</div>
							</div>
							<div class="py-1 pl-3 pr-1 bg-gray-2 rounded-md font-main font-bold text-white-0 flex items-center">
								<p>To:</p>
								<div
									@click="timeFilterEndPopupOpen = true"
									class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
								>
									<p class="mr-2">{{ logState.timeFilterEnd ? new Date(logState.timeFilterEnd).toLocaleString() : 'now' }}</p>
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
						<div v-if="logState.logsFilter === FILTER.EVENT" class="flex flex-wrap gap-2 mt-2">
							<template v-for="(eventName, eventCode) in EVENT_NAMES">
								<div
									class="flex items-center bg-blue-0 px-2 py-1 rounded-md cursor-pointer hover:bg-blue-1"
									@click="logState.eventFilter.has(eventCode) ? logState.eventFilter.delete(eventCode) : logState.eventFilter.add(eventCode)"
								>
									<Checkbox
										class="h-4 w-4"
										:value="logState.eventFilter.has(eventCode)"
									/>
									<span class="ml-2 font-main font-bold text-white-1">
										{{ eventName }}
									</span>
								</div>
							</template>
						</div>
						<div v-if="logState.logsFilter === FILTER.PLAYER" class="mt-2">
							<ValueInput v-model="logState.playerFilter" placeholder="Player username" />
						</div>
						<div v-if="logState.logsFilter === FILTER.IP" class="mt-2">
							<ValueInput v-model="logState.ipFilter" placeholder="IP address" />
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
					<div v-if="logState.queryWasRun" class="mt-4">
						<p class="font-main font-bold text-gray-8">{{ logState.logs.length }} log entries currently loaded</p>
						<FlexButton
							v-if="logState.logs.length > 0"
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
				<div class="grid text-white-0 font-mono text-sm overflow-auto relative" :style="gridStyle">
					<div class="text-white-0 py-1 px-3 text-md font-bold bg-teal-1 sticky top-0">Timestamp</div>
					<div class="text-white-0 py-1 px-3 text-md font-bold bg-teal-1 sticky top-0">Username</div>
					<div class="text-white-0 py-1 px-3 text-md font-bold bg-teal-1 sticky top-0">Event</div>
					<div class="text-white-0 py-1 px-3 text-md font-bold bg-teal-1 sticky top-0">World</div>
					<div class="text-white-0 py-1 px-3 text-md font-bold bg-teal-1 sticky top-0">Player Group</div>
					<div class="text-white-0 py-1 px-3 text-md font-bold bg-teal-1 sticky top-0">TShock Login</div>
					<div v-if="canViewIP" class="text-white-0 py-1 px-3 text-md font-bold bg-teal-1 sticky top-0">IP</div>
					<div class="text-white-0 py-1 px-3 text-md font-bold bg-teal-1 sticky top-0">Players Online</div>
					<div class="text-white-0 py-1 px-3 text-md font-bold bg-teal-1 sticky top-0">Details</div>
					<template v-for="(log, i) in currentLogsPage">
						<div :class="[{'bg-gray-4': i%2}, 'py-1 px-3']">{{ new Date(log.timestamp).toLocaleString() }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'py-1 px-3']">{{ log.playerName }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'py-1 px-3']">{{ log.eventType }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'py-1 px-3']">{{ log.worldName }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'py-1 px-3']">{{ log.playerGroup }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'py-1 px-3']">{{ log.isLoggedIn }}</div>
						<div v-if="canViewIP" :class="[{'bg-gray-4': i%2}, 'py-1 px-3']">{{ log.ip }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'py-1 px-3']">{{ log.playersActive }}</div>
						<div :class="[{'bg-gray-4': i%2}, 'py-1 px-3']">
							<div class="text-blue-2 hover:text-blue-1 cursor-pointer" @click="openAdditional(log)" v-if="hasAdditional(log)">
								<div
									class="inline-flex items-center"
								>
									<span class="font-main font-bold">View</span>
									<Icon icon="external" color="ml-2" size="3" />
								</div>
							</div>
							<span v-else class="text-gray-6">-</span>
						</div>
					</template>
				</div>
				<div class="flex items-center mt-4">
					<FlexButton
						class="px-2!"
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="chevron-left"
						leftIconSize="5"
						:disabled="loading || logState.logsPage === 0"
						@input="previousPage"
					/>
					<p class="font-main font-bold mx-2 text-white-0 text-sm sm:text-md">
						Showing {{ logState.logsPage * logPageSize }} to {{ Math.min((logState.logsPage + 1) * logPageSize, logState.logs.length) }}
						of {{ logState.logs.length }} loaded entries
						({{ logState.lastFetchedLog ? '' : 'no ' }}more available)
					</p>
					<FlexButton
						class="px-2!"
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="chevron-right"
						leftIconSize="5"
						:disabled="loading || (((logState.logsPage + 1) * logPageSize) >= logState.logs.length && !logState.lastFetchedLog)"
						@input="nextPage"
					/>
				</div>
			</div>
		</Popup>

		<CodeEditor
			:open="additionalPopupOpen"
			:model-value="additionalContent"
			:header-text="additionalHeader"
			language="json"
			layer="1"
			read-only
			@cancel="additionalPopupOpen = false"
		/>

		<DateTimePickerPopup
			:open="timeFilterStartPopupOpen"
			@close="timeFilterStartPopupOpen = false"
			@cancel="timeFilterStartPopupOpen = false; logState.timeFilterStart = null;"
			v-model="logState.timeFilterStart"
		/>
		<DateTimePickerPopup
			:open="timeFilterEndPopupOpen"
			@close="timeFilterEndPopupOpen = false"
			@cancel="timeFilterEndPopupOpen = false; logState.timeFilterEnd = null;"
			v-model="logState.timeFilterEnd"
		/>
	</div>
</template>

<script>
import Checkbox from '@/components/common/Checkbox.vue';
import CodeEditor from '@/components/common/CodeEditor.vue';
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
	EVENT: "event",
	IP: "ip",
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
	[EVENT.PCHAT]: "Player chat",
	[EVENT.PDEATH]: "Player death",
	[EVENT.PSPAWN]: "Player (re)spawn",
	// [EVENT.WSAVE]: "World save",
	// [EVENT.WRELOAD]: "Server reload",
};

/**
 * Everything that belongs to one instance: the query the user built and whatever that
 * query loaded. Each instance gets its own copy so switching the selection swaps the
 * whole tile over rather than showing another instance's results. Anything not in here
 * (popup visibility, the additional-data viewer) is transient chrome that isn't worth
 * carrying per instance.
 */
function defaultLogState() {
	return {
		logsFilter: FILTER.ALL,
		timeFilterStart: null,
		timeFilterEnd: null,
		eventFilter: new Set([EVENT.PJOIN, EVENT.PLEAVE, EVENT.PDEATH, EVENT.PSPAWN]),
		playerFilter: "",
		ipFilter: "",
		logs: [],
		logsPage: 0,
		lastFetchedLog: undefined,
		queryWasRun: false,
		lastQuery: null,
	};
}

export default {
	mixins: [],
	components: {
		Dropdown,
		DateTimePickerPopup,
		Checkbox,
		CodeEditor,
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
			timeFilterStartPopupOpen: false,
			timeFilterEndPopupOpen: false,
			logViewPopupOpen: false,
			additionalPopupOpen: false,
			additionalContent: "",
			additionalHeader: "ADDITIONAL DATA",

			logPageSize: 50,

			// instance ID -> defaultLogState(); loading is keyed the same way so a fetch
			// left running against one instance doesn't spin the tile for another.
			instanceStates: {},
			loadingByInstance: {},
			loadingSessionByInstance: {},
		}
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		/** State key for the current selection; "" covers the no-instance-selected case. */
		stateKey() {
			return this.selectedInstance ?? "";
		},
		logState() {
			return this.instanceStates[this.stateKey];
		},
		loading() {
			return this.loadingByInstance[this.stateKey] || false;
		},
		loadingActiveSession() {
			return this.loadingSessionByInstance[this.stateKey] || false;
		},
		queryParams() {
			return this.buildQueryParams(this.logState);
		},
		sameQuery() {
			return deepObjsEqual(this.queryParams, this.logState.lastQuery);
		},
		currentLogsPage() {
			const { logs, logsPage } = this.logState;
			return logs.slice(logsPage * this.logPageSize, (logsPage + 1) * this.logPageSize);
		},
		canViewIP() {
			return this.$checkPermissions(PERMISSIONS.server.logs.players.ips.read);
		},
		gridStyle() {
			return `grid-template-columns: repeat(${this.canViewIP ? 9 : 8}, minmax(max-content, 1fr));`;
		}
	},
	methods: {
		/** Creates this instance's state entry if it doesn't have one yet, and returns it. */
		ensureState(key) {
			if (!this.instanceStates[key]) {
				this.instanceStates[key] = defaultLogState();
			}
			return this.instanceStates[key];
		},
		/**
		 * Built from an explicit state rather than the current selection so an in-flight
		 * request keeps describing the instance it was issued for even if the user switches.
		 */
		buildQueryParams(state) {
			const params = {
				lastValue: state.lastFetchedLog || null,
				startTime: state.timeFilterStart ? Date.parse(state.timeFilterStart) : null,
				endTime: state.timeFilterEnd ? Date.parse(state.timeFilterEnd) : null,
				player: state.logsFilter === FILTER.PLAYER ? state.playerFilter : null,
				ip: state.logsFilter === FILTER.IP ? state.ipFilter : null,
			};

			if (state.logsFilter === FILTER.EVENT) {
				if (state.eventFilter.size === 1) {
					params.eventType = Array.from(state.eventFilter.values())[0];
				} else {
					params.eventTypes = Array.from(state.eventFilter);
				}
			} else {
				params.eventType = null;
			}

			return params;
		},
		/**
		 * Whether an entry carries any event-specific data worth opening. The
		 * column is per-event, so most rows have nothing here.
		 */
		hasAdditional(log) {
			const additional = log?.additional;
			return !!additional && typeof additional === "object" && Object.keys(additional).length > 0;
		},
		openAdditional(log) {
			this.additionalHeader = `ADDITIONAL DATA: ${log.eventType ?? "EVENT"}`;
			this.additionalContent = JSON.stringify(log.additional, null, "\t");
			this.additionalPopupOpen = true;
		},
		async fetchInitial() {
			await this.$validatePermissions(PERMISSIONS.server.logs.players.read);

			if (this.loading) return;

			const instanceID = this.selectedInstance;
			const state = this.logState;

			state.logs = [];
			state.lastFetchedLog = null;
			state.logsPage = 0;

			const success = await this.fetchLogs(instanceID, state, this.buildQueryParams(state));
			state.queryWasRun = true;

			// Don't throw the viewer open over whatever the user switched to mid-fetch.
			if (this.selectedInstance === instanceID) {
				this.logViewPopupOpen = true;
			}

			if (success) {
				state.lastQuery = this.buildQueryParams(state);
			}
		},
		async fetchLogs(instanceID, state, params) {
			await this.$validatePermissions(PERMISSIONS.server.logs.players.read);

			if (this.loadingByInstance[instanceID ?? ""]) return;

			if (state.logsFilter === FILTER.EVENT && !state.eventFilter.size) {
				this.$alert.warning("Please select at least one event type");
				return;
			}
			if (state.logsFilter === FILTER.PLAYER && !params.player) {
				this.$alert.warning("Please enter a full player username");
				return;
			}
			if (params.startTime && params.endTime && params.startTime > params.endTime) {
				this.$alert.warning("The 'from' time must be before the 'to' time");
				return;
			}
			if (params.ip && !params.ip.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/gm)) {
				this.$alert.warning("Invalid IP address");
				return;
			}

			this.loadingByInstance[instanceID ?? ""] = true;

			try {
				const result = await post(`/logging/${instanceID}/players/fetch`, PERMISSIONS.server.logs.players.read, params);
				// Results go to the state they were requested for, not to whatever is selected
				// when they land — the user is free to switch instances mid-request.
				state.logs.push(...result.entries);
				state.lastFetchedLog = result.lastValue;
				return true;
			} catch (e) {
				this.$alert.error("Failed to fetch logs");
				console.error(e);
				return false;
			} finally {
				this.loadingByInstance[instanceID ?? ""] = false;
			}
		},
		previousPage() {
			const state = this.logState;
			if (state.logsPage === 0) return;
			state.logsPage = state.logsPage - 1;
		},
		async nextPage() {
			const instanceID = this.selectedInstance;
			const state = this.logState;

			if ((state.logsPage + 1) * this.logPageSize >= state.logs.length) {
				if (state.lastFetchedLog) {
					const success = await this.fetchLogs(instanceID, state, this.buildQueryParams(state));
					if (!success) {
						return;
					}
				} else {
					return;
				}
			}

			state.logsPage = state.logsPage + 1;
		},
		async detectRunningSession() {
			await this.$validatePermissions(PERMISSIONS.server.logs.players.read);

			const instanceID = this.selectedInstance;
			const state = this.logState;

			if (this.loadingSessionByInstance[instanceID ?? ""]) return;
			this.loadingSessionByInstance[instanceID ?? ""] = true;

			try {
				await this.serverStore.fetchServerStatus(instanceID);
				const uptime = this.serverStore.serverStatusData[instanceID]?.uptime ?? "";

				const timeRegex = /^(\d+)\.(\d{2}):(\d{2}):(\d{2}$)/gm;
				if (!uptime || !uptime.match(timeRegex)) {
					this.$alert.error("Invalid session duration. Could not detect session.");
					return;
				}

				const results = timeRegex.exec(uptime);
				const [full, days, hours, minutes, seconds] = results; // not entirely sure that the first number is days, I've never had a session get long enough for it to be not 0

				const totalInSec = (parseInt(days) * 24 * 60 * 60) + (parseInt(hours) * 60 * 60) + (parseInt(minutes) * 60) + parseInt(seconds);
				const sessionStart = Date.now() - (totalInSec * 1000) - (60 * 1000); // plus one minute of grace

				const d = new Date(sessionStart);
				const pad = n => String(n).padStart(2, '0');
				state.timeFilterStart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
			} catch (e) {
				this.$alert.error("Failed to detect session");
			} finally {
				this.loadingSessionByInstance[instanceID ?? ""] = false;
			}
		}
	},
	watch: {
		// Immediate so `logState` is never undefined by the time anything renders or reads it.
		stateKey: {
			immediate: true,
			handler(key) {
				this.ensureState(key);
				// The viewer belongs to the results that were on screen; a different instance's
				// results don't belong behind it.
				this.logViewPopupOpen = false;
				this.additionalPopupOpen = false;
			}
		}
	},
	mounted() {
		if (this.$checkPermissions(PERMISSIONS.server.logs.players.ips.read)) {
			this.filterByOptions.push({ id: FILTER.IP, text: "Specific IP address" });
		}
	}
}
</script>

<style scoped>
</style>
