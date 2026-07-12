<template>
	<div>
		<StatusTile
			class="grow mt-2 gradient-tile"
			:perm-required="PERMISSIONS.server.logs.tshock.read"
			:loading="loading"
		>
			<template #header>
				<Icon icon="file-lines" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">TShock Logs</p>
			</template>
			<template #content>
				<div class="px-4 pb-4">
					<div class="bg-gray-1 px-4 pb-4 pt-2 rounded-md">
						<div class="flex items-center justify-between mb-2">
							<p class="font-main font-bold text-gray-8">ALL LOGS</p>
							<FlexButton
								class="px-2!"
								:variant="BTN_VARIANT.SECONDARY"
								leftIcon="arrow-rotate-right"
								leftIconSize="4"
								:disabled="listLoading"
								:loading="listLoading"
								@input="fetchLogList"
							/>
						</div>

						<p v-if="!listLoading && logFiles.length === 0 && listLoaded" class="font-main text-gray-6 italic">
							No log files available for this server yet.
						</p>

						<div v-if="logFiles.length > 0" class="max-h-64 overflow-auto rounded-md">
							<div class="min-w-max">
								<div class="grid logs-grid font-main font-bold text-gray-8 text-sm sticky top-0 bg-gray-4">
									<div class="px-3 py-2">Date</div>
									<div class="px-3 py-2">Content</div>
									<div class="px-3 py-2">Size</div>
									<div class="px-3 py-2"></div>
								</div>
								<div
									v-for="(file, i) in logFiles"
									:key="`${file.date}-${file.stream}`"
									class="grid logs-grid items-center cursor-pointer font-mono text-sm text-white-0 hover:bg-gray-5"
									:class="i % 2 ? 'bg-gray-4' : 'bg-gray-3'"
									@click="viewTranscript(file)"
								>
									<div class="px-3 py-2">{{ new Date(`${file.date}T00:00:00Z`).toLocaleDateString() }}</div>
									<div class="px-3 py-2 font-bold">
										{{ file.stream === 'err' ? 'errors' : 'general' }}
									</div>
									<div class="px-3 py-2">{{ formatBytes(file.size) }}</div>
									<div class="px-3 py-2 flex items-center justify-end">
										<Spinner v-if="transcriptLoading && loadingFileKey === `${file.date}-${file.stream}`" class="h-4 w-4 text-teal-4" />
										<Icon v-else icon="external" color="text-white-1" size="4" />
									</div>
								</div>
							</div>
						</div>
					</div>


					<div class="mt-4">
						<div class="flex flex-wrap gap-2 items-center">
							<ValueInput v-model="pattern" placeholder="Text or regex pattern to search for" class="w-full sm:w-1/4 sm:min-w-80" />
							<div
								class="flex items-center bg-blue-0 px-2 py-1 rounded-md cursor-pointer hover:bg-blue-1"
								@click="useRegex = !useRegex"
							>
								<Checkbox class="h-4 w-4" :value="useRegex" />
								<span class="ml-2 font-main font-bold text-white-1">Use regex</span>
							</div>
							<div
								class="flex items-center bg-blue-0 px-2 py-1 rounded-md cursor-pointer hover:bg-blue-1"
								@click="caseSensitive = !caseSensitive"
							>
								<Checkbox class="h-4 w-4" :value="caseSensitive" />
								<span class="ml-2 font-main font-bold text-white-1">Case sensitive</span>
							</div>
						</div>
						<div class="flex flex-wrap gap-2 items-center mt-2">
							<Dropdown
								class="w-full sm:w-1/3 sm:min-w-80"
								inputClass="bg-teal-3 text-white-1"
								iconColor="text-white-1"
								:options="streamOptions"
								v-model="streamFilter"
							/>
							
						</div>
						<div class="flex flex-wrap gap-2 items-center mt-2">
							<div class="py-1 pl-3 pr-1 bg-gray-2 rounded-md font-main font-bold text-white-0 flex items-center">
								<p>From:</p>
								<div
									@click="timeFilterStartPopupOpen = true"
									class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
								>
									<p class="mr-2">{{ timeFilterStart ? new Date(timeFilterStart).toLocaleDateString() : 'last 30 days' }}</p>
									<Icon icon="edit" color="text-white-1" size="5" />
								</div>
							</div>
							<div class="py-1 pl-3 pr-1 bg-gray-2 rounded-md font-main font-bold text-white-0 flex items-center">
								<p>To:</p>
								<div
									@click="timeFilterEndPopupOpen = true"
									class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
								>
									<p class="mr-2">{{ timeFilterEnd ? new Date(timeFilterEnd).toLocaleDateString() : 'today' }}</p>
									<Icon icon="edit" color="text-white-1" size="5" />
								</div>
							</div>
						</div>
						<FlexButton
							class="mt-4"
							:variant="BTN_VARIANT.SECONDARY"
							leftIcon="cloud-download"
							leftIconSize="5"
							:disabled="loading"
							:loading="loading"
							@input="search"
						>
							SEARCH
						</FlexButton>
					</div>

					<div v-if="queryWasRun" class="mt-4">
						<p class="font-main font-bold text-gray-8">
							{{ matches.length }} match{{ matches.length === 1 ? '' : 'es' }} found across {{ filesScanned }} log file{{ filesScanned === 1 ? '' : 's' }}
							<span v-if="truncated">(results truncated, narrow your search for more)</span>
						</p>
						<FlexButton
							v-if="matches.length > 0"
							class="mt-2"
							:variant="BTN_VARIANT.SECONDARY"
							leftIcon="external"
							leftIconSize="4"
							@input="resultsPopupOpen = true"
						>
							VIEW RESULTS
						</FlexButton>
					</div>
				</div>
			</template>
		</StatusTile>

		<Popup
			headerText="TSHOCK LOG MATCHES"
			bodyClass="h-11/12 w-11/12"
			:open="resultsPopupOpen"
			@xClicked="resultsPopupOpen = false"
		>
			<div class="px-4 pb-4 flex flex-col h-full">
				<p class="my-2 text-gray-6 font-bold italic">Dates are displayed in UTC (matches the server's daily log rotation)</p>
				<div class="overflow-auto grow font-mono text-sm">
					<template v-for="(match, i) in matches">
						<div :class="[{'bg-gray-4': i % 2}, 'p-2 whitespace-pre-wrap break-all']">
							<span class="text-teal-3 font-bold">[{{ match.date }} {{ match.stream }}:{{ match.lineNumber }}]</span>
							<span class="text-white-0 ml-2">{{ match.line }}</span>
						</div>
					</template>
				</div>
			</div>
		</Popup>

		<Popup
			:headerText="transcriptHeader"
			bodyClass="h-11/12 w-11/12"
			:open="transcriptPopupOpen"
			@xClicked="transcriptPopupOpen = false"
		>
			<div class="px-4 pb-4 flex flex-col h-full">
				<p class="my-2 text-gray-6 font-bold italic">
					{{ formatBytes(transcriptSize) }} &mdash; dates/times in the log content itself are in the server's local time
				</p>
				<pre class="overflow-auto grow font-mono text-sm whitespace-pre-wrap break-all text-white-0 bg-gray-4 p-2 rounded-md">{{ transcriptContent }}</pre>
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
import Spinner from '@/components/common/Spinner.vue';
import ValueInput from '@/components/common/ValueInput.vue';
import { useServerStore } from '@/stores/serverStore';
import { post } from '@/util/api';
import { BTN_VARIANT } from '@/util/constants';
import { PERMISSIONS } from '@/util/permissionValues';

const toDateOnly = (value) => {
	if (!value) return null;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toISOString().slice(0, 10);
};

const LARGE_TRANSCRIPT_WARNING_BYTES = 5 * 1024 * 1024;

export default {
	components: {
		Checkbox,
		DateTimePickerPopup,
		Dropdown,
		FlexButton,
		Icon,
		Popup,
		ValueInput,
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,

			serverStore: useServerStore(),

			streamOptions: [
				{ id: "out", text: "General output logs only" },
				{ id: "err", text: "Fatal error logs only" },
				{ id: "both", text: "General output logs and fatal error logs" },
			],

			pattern: "",
			useRegex: false,
			caseSensitive: false,
			streamFilter: "out",
			timeFilterStart: null,
			timeFilterEnd: null,
			timeFilterStartPopupOpen: false,
			timeFilterEndPopupOpen: false,

			loading: false,
			queryWasRun: false,
			resultsPopupOpen: false,
			matches: [],
			truncated: false,
			filesScanned: 0,

			logFiles: [],
			listLoading: false,
			listLoaded: false,

			transcriptLoading: false,
			loadingFileKey: null,
			transcriptPopupOpen: false,
			transcriptContent: "",
			transcriptSize: 0,
			transcriptHeader: "",
		}
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
	},
	methods: {
		async search() {
			await this.$validatePermissions(PERMISSIONS.server.logs.tshock.read);

			if (this.loading) return;

			if (!this.pattern.trim()) {
				this.$alert.warning("Enter a pattern to search for");
				return;
			}

			if (this.useRegex) {
				try {
					new RegExp(this.pattern);
				} catch (e) {
					this.$alert.warning("Invalid regex pattern");
					return;
				}
			}

			const startDate = toDateOnly(this.timeFilterStart);
			const endDate = toDateOnly(this.timeFilterEnd);
			if (startDate && endDate && startDate > endDate) {
				this.$alert.warning("The 'from' date must be before the 'to' date");
				return;
			}

			this.loading = true;

			try {
				const body = {
					pattern: this.pattern,
					useRegex: this.useRegex,
					caseSensitive: this.caseSensitive,
					stream: this.streamFilter,
					...(startDate ? { startDate } : {}),
					...(endDate ? { endDate } : {}),
				};

				const result = await post(`/logging/${this.selectedInstance}/tshock/search`, PERMISSIONS.server.logs.tshock.read, body);
				this.matches = result.matches;
				this.truncated = result.truncated;
				this.filesScanned = result.filesScanned;
				this.queryWasRun = true;
				this.resultsPopupOpen = this.matches.length > 0;
			} catch (e) {
				this.$alert.error("Failed to search console logs");
				console.error(e);
			} finally {
				this.loading = false;
			}
		},
		formatBytes(bytes) {
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		},
		async fetchLogList() {
			if (!this.selectedInstance) return;
			if (this.listLoading) return;

			this.listLoading = true;

			try {
				const result = await post(`/logging/${this.selectedInstance}/tshock/list`, PERMISSIONS.server.logs.tshock.read, {});
				this.logFiles = result.files.filter((file) => file.size > 0);
				this.listLoaded = true;
			} catch (e) {
				this.$alert.error("Failed to load log file list");
				console.error(e);
			} finally {
				this.listLoading = false;
			}
		},
		async viewTranscript(file) {
			await this.$validatePermissions(PERMISSIONS.server.logs.tshock.read);

			if (this.transcriptLoading) return;

			this.transcriptLoading = true;
			this.loadingFileKey = `${file.date}-${file.stream}`;

			try {
				const result = await post(`/logging/${this.selectedInstance}/tshock/transcript`, PERMISSIONS.server.logs.tshock.read, {
					date: file.date,
					stream: file.stream,
				});

				if (result.size > LARGE_TRANSCRIPT_WARNING_BYTES) {
					this.$alert.warning(`This log is ${(result.size / (1024 * 1024)).toFixed(1)} MB, it may take a moment to load`);
				}

				// Fetched directly from S3 (not through the API) so we aren't bound by the
				// Lambda/API Gateway response size limits a full day's transcript could exceed.
				const response = await fetch(result.url);
				if (!response.ok) {
					throw new Error(`Failed to download transcript (${response.status})`);
				}

				this.transcriptContent = await response.text();
				this.transcriptSize = result.size;
				this.transcriptHeader = `${file.stream === 'err' ? 'ERROR' : 'CONSOLE'} TRANSCRIPT — ${new Date(`${file.date}T00:00:00Z`).toLocaleDateString()}`;
				this.transcriptPopupOpen = true;
			} catch (e) {
				this.$alert.error(e?.message?.toLowerCase().includes('not found')
					? "This log file is no longer available"
					: "Failed to load log transcript");
				console.error(e);
			} finally {
				this.transcriptLoading = false;
				this.loadingFileKey = null;
			}
		},
	},
	mounted() {
		if (this.selectedInstance && this.$checkPermissions(PERMISSIONS.server.logs.tshock.read)) {
			this.fetchLogList();
		}
	},
	watch: {
		selectedInstance(value) {
			this.logFiles = [];
			this.listLoaded = false;
			if (value && this.$checkPermissions(PERMISSIONS.server.logs.tshock.read)) {
				this.fetchLogList();
			}
		},
	},
}
</script>

<style scoped>
.logs-grid {
	grid-template-columns: repeat(4, minmax(5rem, 1fr));
}
</style>
