<template>
	<StatusTile 
		class="grow mt-2 gradient-tile"
		collapsible
		:perm-required="PERMISSIONS.server.logs.read"
		:loading="loading"
	>
		<template #header>
			<Icon icon="file-lines" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Player Logs</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">Logs available</p>
		</template>
		<template #content>
			<div class="px-4 pb-4">
				<div class="bg-gray-2 p-4 rounded-md">
					<p class="font-main font-bold text-gray-7">FILTER LOGS:</p>
					<div class="flex gap-2 items-center mt-2">
						<Dropdown
							class="sm:max-w-1/4"
							inputClass="bg-teal-3 text-white-1"
							iconColor="text-white-1"
							:options="filterByOptions"
							v-model="logsFilter"
						/>
						
						<div class="py-1 pl-3 pr-1 bg-gray-3 rounded-md font-main font-bold text-white-0 flex items-center">
							<p>From:</p>
							<div 
								@click="timeFilterStartPopupOpen = true"
								class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
							>
								<p class="mr-2">{{ timeFilterStart || 'forever ago' }}</p> 
								<Icon icon="edit" color="text-white-1" size="5" />
							</div>
						</div>

						<div class="py-1 pl-3 pr-1 bg-gray-3 rounded-md font-main font-bold text-white-0 flex items-center">
							<p>To:</p>
							<div 
								@click="timeFilterEndPopupOpen = true"
								class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
							>
								<p class="mr-2">{{ timeFilterEnd || 'now' }}</p> 
								<Icon icon="edit" color="text-white-1" size="5" />
							</div>
						</div>

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

					<div v-if="logsFilter === FILTER.EVENT" class="flex gap-2 mt-2">
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
						class="mt-4"
						:variant="BTN_VARIANT.SECONDARY"
						leftIcon="cloud-download"
						leftIconSize="5"
						:disabled="loading || sameQuery"
						@input="fetchInitial"
					>
						RUN QUERY
					</FlexButton>
				</div>

				<div v-if="queryWasRun">
					<p class="mt-4 text-gray-6 font-bold italic">Dates and times are displayed in your time zone</p>
					<div class="grid log-grid py-2 text-white-0 font-mono text-sm overflow-x-auto">
						<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Timestamp</div>
						<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Username</div>
						<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Event</div>
						<div class="text-white-0 p-1 text-md font-bold bg-teal-1">World</div>
						<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Player Group</div>
						<div class="text-white-0 p-1 text-md font-bold bg-teal-1">TShock Login</div>
						<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Players Online</div>
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
					<div class="flex items-center">
						<FlexButton
							class="px-2!"
							:variant="BTN_VARIANT.SECONDARY"
							leftIcon="chevron-left"
							leftIconSize="5"
							:disabled="logsPage === 0"
							@input="previousPage"
						/>
						<p class="font-main font-bold mx-2 text-white-0">
							Showing {{ logsPage * logPageSize }} to {{ Math.min((logsPage + 1) * logPageSize, logs.length) }}
							of {{ logs.length }} fetched,
							{{ lastFetchedLog ? '' : 'no' }} more available
						</p>
						<FlexButton
							class="px-2!"
							:variant="BTN_VARIANT.SECONDARY"
							leftIcon="chevron-right"
							leftIconSize="5"
							:disabled="((logsPage + 1) * logPageSize) > logs.length && !lastFetchedLog"
							@input="nextPage"
						/>
					</div>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import Checkbox from '@/components/common/Checkbox.vue';
import DateTimePickerPopup from '@/components/common/DateTimePickerPopup.vue';
import Dropdown from '@/components/common/Dropdown.vue';
import FlexButton from '@/components/common/FlexButton.vue';
import Icon from '@/components/common/Icon.vue';
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
			loading: false,

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
		queryParams() {
			const params = {
				lastValue: this.lastFetchedLog || null,
				startTime: this.timeFilterStart ? Date.parse(this.timeFilterStart) : null,
				endTime: this.timeFilterEnd ? Date.parse(this.timeFilterEnd) : null,
				player: this.logsFilter === FILTER.PLAYER ? this.playerFilter : null,
			};

			if (this.logsFilter === FILTER.EVENT) {
				if (this.eventFilter.size === 1) {
					params.eventType = this.eventFilter.values()[0];
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
			const success = await this.fetchLogs();

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
				this.lastFetchedLog = result.lastKey;
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
			if ((this.logsPage + 1) * this.logPageSize > this.logs.length) {
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
		}
	},
}
</script>

<style scoped>
.log-grid {
	grid-template-columns: repeat(7, minmax(max-content, 1fr));
}
</style>
