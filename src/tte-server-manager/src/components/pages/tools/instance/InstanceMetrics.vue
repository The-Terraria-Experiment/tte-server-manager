<template>
	<StatusTile
		:perm-required="[PERMISSIONS.instance.metrics.read, PERMISSIONS.instance.metrics.write]"
		match-any-permission
		collapsible
		class="mt-2"
		:loading="loading.fetch || loading.save || loading.upload || loading.selftest || loading.metrics"
	>
		<template #header>
			<Icon icon="gauge" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Metrics</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">{{ summaryText }}</p>
		</template>
		<template #content>
			<div class="p-4">
				<!--
					Nothing below the load guard may render a value. Falling back to
					defaults here would show a confident, wrong "ON, every 60s" for a
					collector whose real state was never read.
				-->
				<div v-if="!loaded">
					<p v-if="loadError && !loading.fetch" class="font-main font-semibold text-gray-7 mt-2">
						{{ loadError }}
					</p>
					<p v-else>There was an error</p>
				</div>

				<template v-else>
					<!--
						The values below are real defaults, not a reading of this instance —
						the cheap read has no `actual` to contradict them, so without saying
						so the tile would describe a collector that may never have run.
					-->
					<p v-if="configured === false" class="font-main font-bold text-yellow-2 mb-4">
						No saved configuration for this instance. The values below are defaults, not a reading of
						what it's running — refresh to ask the instance, or save to apply them.
					</p>

					<!--
						Distinct from drift: the stored config and the box agree here, and
						the box still isn't sampling. Only a verified read can say this, so
						it only ever appears after a refresh.
					-->
					<p v-if="stalled" class="font-main font-bold text-yellow-2 mb-4">
						The collector is enabled but its timer has no next run scheduled, so it isn't sampling.
						Save to re-apply the configuration and restart it.
					</p>

					<p v-if="drift" class="font-main font-bold text-yellow-2 mb-4">
						The instance isn't running the saved configuration. Save again to re-apply it.
					</p>

					<div class="bg-gray-2 p-4 rounded-lg border border-gray-5">
						<div class="flex justify-between items-start">
							<div class="flex items-center gap-2">
								<Checkbox
									class="h-4 w-4"
									:value="form.enabled"
									:disabled="!canEdit"
									@input="form.enabled = !form.enabled"
								/>
								<p :class="['font-main font-bold text-gray-8', { 'cursor-pointer': canEdit }]" @click="form.enabled = !form.enabled">Enabled</p>
							</div>
							<div>
								<RefreshButton
									v-if="$checkPermissions(PERMISSIONS.instance.metrics.read)"
									:variant="BTN_VARIANT.SECONDARY"
									:disabled="loading.fetch"
									@input="refresh"
								/>
							</div>
						</div>
						<div class="flex justify-between flex-wrap gap-y-6">
							<div class="flex mt-2 gap-4 flex-wrap">
								<div class="flex flex-col gap-y-2 border-gray-6 rounded">
									<p class="font-main font-bold text-gray-8">Sample interval (sec)</p>
									<ValueInput
										type="number"
										v-model="form.collectSec"
										:disabled="!canEdit || !form.enabled"
										class="w-56"
									/>
								</div>
								<div class="flex flex-col gap-y-2 border-gray-6 rounded">
									<p class="font-main font-bold text-gray-8">Upload mode</p>
									<Dropdown
										:options="uploadModeOptions"
										v-model="form.uploadMode"
										:disabled="!canEdit || !form.enabled"
										inputClass="bg-gray-5 text-white-0"
										class="max-w-80 min-w-58"
									/>
								</div>
								<div class="flex flex-col gap-y-2 border-gray-6 rounded" v-if="form.uploadMode === 'timer'">
									<p class="font-main font-bold text-gray-8">Upload interval (sec)</p>
									<ValueInput
										type="number"
										v-model="form.uploadSec"
										:disabled="!canEdit || !form.enabled"
										class="w-56"
									/>
								</div>
								<div class="flex flex-col gap-y-2 border-gray-6 rounded">
									<p class="font-main font-bold text-gray-8">Persistence (days)</p>
									<ValueInput
										type="number"
										v-model="form.retainDays"
										:disabled="!canEdit || !form.enabled"
										class="w-56"
									/>
								</div>
							</div>

							<div class="flex gap-4">
								<FlexButton
									v-if="canEdit && hasChanges"
									:variant="BTN_VARIANT.DANGER"
									:disabled="loading.save"
									@input="resetForm"
									class="max-h-max self-end"
								>
									<p class="font-main font-bold py-2 px-8 md:px-12">DISCARD</p>
								</FlexButton>
								<!--
									Also shown on drift with an unchanged form: the banner above tells
									the user to save again to re-apply the stored config, which needs a
									button to press.
								-->
								<FlexButton
									v-if="canEdit && (hasChanges || drift)"
									:variant="BTN_VARIANT.PRIMARY"
									:disabled="loading.save"
									@input="save"
									class="max-h-max self-end"
								>
									<p class="font-main font-bold py-2 px-8 md:px-12">SAVE</p>
								</FlexButton>
							</div>
						</div>
					</div>
					

					<!-- <p v-if="form.uploadMode === 'manual'" class="font-main font-semibold text-gray-7 mt-4 max-w-2xl">
						In manual mode nothing is uploaded on a schedule. Samples reach S3 when the instance shuts down, or
						when you upload now. Between those points they exist only on the instance's disk.
					</p> -->

					<div v-if="actual" class="flex flex-wrap gap-x-8 gap-y-2 mt-4 font-main font-semibold text-gray-7">
						<p>Buffered hours: <span class="text-teal-4">{{ actual.pendingFiles }}</span></p>
						<p>Last upload: <span class="text-teal-4">{{ lastUploadText }}</span></p>
					</div>

					<!--
						Kept on screen rather than left to the alert: alerts for non-errors
						expire after 5s, and the result of a diagnostic is the thing you
						want still readable while you go fix what it found.
					-->
					<div v-if="selftestResult" class="mt-4 font-main font-semibold">
						<p :class="selftestResult.ok ? 'text-teal-4' : 'text-yellow-2'">
							{{ selftestResult.ok ? "Upload selftest passed" : "Upload selftest failed" }}
							<span class="text-gray-7">— {{ selftestResult.at }}</span>
						</p>
						<p v-if="selftestResult.message" class="text-gray-7 mt-1 max-w-2xl">
							{{ selftestResult.message }}
						</p>
					</div>

				</template>

				<!--
					Outside the config load guard on purpose: the samples live in S3, so
					they are readable whether or not the collector's configuration could
					be read, and whether or not the instance is running.

					One range for the whole section — every graph below plots the same
					window so they can be read against each other.
				-->
				<div class="mt-10">
					<div class="flex flex-wrap items-end justify-between gap-4">
						<div class="flex flex-wrap items-end gap-4">
							<div class="flex flex-col gap-y-2">
								<p class="font-main font-bold text-gray-8">Time range</p>
								<Dropdown
									:options="rangeOptions"
									v-model="range.preset"
									:disabled="loading.metrics"
									inputClass="bg-gray-5 text-white-0"
									class="max-w-80 min-w-58"
								/>
							</div>
							<template v-if="range.preset === 'custom'">
								<div class="flex flex-col gap-y-2">
									<p class="font-main font-bold text-gray-8">From</p>
									<DateTimePicker v-model="range.customStart" :disabled="loading.metrics" class="w-64" />
								</div>
								<div class="flex flex-col gap-y-2">
									<p class="font-main font-bold text-gray-8">To</p>
									<DateTimePicker v-model="range.customEnd" :disabled="loading.metrics" class="w-64" />
								</div>
								<!--
									Explicit rather than fetching on every edit: a custom range is
									two fields, and firing a multi-object S3 read as the user is
									halfway through picking the second one is wasted work.
								-->
								<FlexButton
									:variant="BTN_VARIANT.PRIMARY"
									:disabled="loading.metrics"
									@input="fetchMetrics"
									class="max-h-max"
								>
									<p class="font-main font-bold py-2 px-8">APPLY</p>
								</FlexButton>
							</template>
						</div>
						<RefreshButton
							:variant="BTN_VARIANT.SECONDARY"
							:disabled="loading.metrics"
							@input="fetchMetrics"
						/>
					</div>

					<p v-if="metricsError" class="font-main font-bold text-yellow-2 mt-4">
						{{ metricsError }}
					</p>

					<!--
						The samples come out of S3, not off the box, so the newest point is
						as old as the last upload. Saying so is the difference between
						"nothing happened recently" and "nothing has been uploaded recently".
					-->
					<p v-else-if="metrics" class="font-main font-semibold text-gray-7 mt-4">
						<span v-if="metricsSummary">{{ metricsSummary }}</span>
						<span v-else>No samples were collected in this range.</span>
					</p>

					<p v-if="metrics && metrics.truncated" class="font-main font-bold text-yellow-2 mt-2">
						This range was too large to read in full — only {{ formatTimestamp(metrics.coveredStart) }} onward is shown.
					</p>

					<div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
						<div class="flex flex-col">
							<!--
								Height pinned rather than left to the content: the memory graph's
								header carries a padded control and this one only text, and the
								graphs below are a fixed height, so a taller header there would
								offset the two plots from each other by a few pixels.
							-->
							<div class="flex items-center justify-between mb-2 gap-4 min-h-8">
								<p class="font-main font-bold">CPU usage</p>
								<!--
									Two lines that converge wherever a bucket holds a single
									sample, so the key is what tells you which one you're reading
									when they separate.
								-->
								<div class="flex items-center gap-4 font-main font-semibold text-gray-7 text-sm">
									<span class="flex items-center gap-2">
										<span class="inline-block w-4 h-0.5" :style="{ backgroundColor: seriesConfig.avg.color }" />
										Average
									</span>
									<span class="flex items-center gap-2">
										<span class="inline-block w-4 h-0.5" :style="{ backgroundColor: seriesConfig.max.color }" />
										Peak
									</span>
								</div>
							</div>
							<Graph
								v-if="hasMetricData"
								class="h-80 rounded-lg overflow-hidden border border-gray-5"
								:points="cpuPoints"
								:axes-config="graphAxesConfig"
								:series-config="seriesConfig"
							/>
							<div v-else class="h-80 rounded-lg border border-gray-5 bg-gray-2 flex items-center justify-center">
								<p class="font-main font-semibold text-gray-7">{{ emptyGraphText }}</p>
							</div>
						</div>
						<div class="flex flex-col">
							<div class="flex items-center justify-between mb-2 gap-4 min-h-8">
								<p class="font-main font-bold">Memory usage</p>
								<!--
									Both figures come off every sample. Percent answers "how loaded
									is this box"; MB answers "how much is it actually using", which
									is the one that survives a comparison between instances of
									different sizes and the only one that informs a resize.
								-->
								<div class="flex rounded border border-gray-5 overflow-hidden">
									<button
										v-for="option in memoryUnitOptions"
										:key="option.id"
										type="button"
										:class="[
											'font-main font-semibold text-sm px-3 py-1',
											memoryUnit === option.id ? 'bg-gray-5 text-white-0' : 'text-gray-7 hover:text-gray-8'
										]"
										@click="memoryUnit = option.id"
									>
										{{ option.text }}
									</button>
								</div>
							</div>
							<Graph
								v-if="hasMetricData"
								class="h-80 rounded-lg overflow-hidden border border-gray-5"
								:points="memoryPoints"
								:axes-config="memoryAxesConfig"
								:series-config="seriesConfig"
							/>
							<div v-else class="h-80 rounded-lg border border-gray-5 bg-gray-2 flex items-center justify-center">
								<p class="font-main font-semibold text-gray-7">{{ emptyGraphText }}</p>
							</div>
						</div>
					</div>
				</div>

				<div class="flex flex-wrap justify-end w-full mt-6 gap-4">
					<FlexButton
						v-if="loaded && instanceOnline && $checkPermissions(PERMISSIONS.instance.metrics.read)"
						:variant="BTN_VARIANT.SECONDARY"
						:disabled="loading.selftest || isShuttingDown"
						@input="runSelftest"
					>
						SELF-TEST
					</FlexButton>
					<FlexButton
						v-if="loaded && instanceOnline && $checkPermissions(PERMISSIONS.instance.metrics.read)"
						:variant="BTN_VARIANT.SECONDARY"
						:disabled="loading.upload || isShuttingDown"
						@input="uploadNow"
					>
						UPLOAD NOW
					</FlexButton>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import RefreshButton from '@/components/common/RefreshButton.vue';
import { get, post, put } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Checkbox from '../../../common/Checkbox.vue';
import Dropdown from '../../../common/Dropdown.vue';
import ValueInput from '../../../common/ValueInput.vue';
import DateTimePicker from '../../../common/DateTimePicker.vue';
import Graph from '@/components/common/Graph.vue';

// Mirrors METRICS_BOUNDS in _shared/shared/utils/InstanceMetrics.ts and the
// *_MIN/*_MAX constants in tte-metrics-ctl.sh. Checked here only to give a
// useful message before the round trip; the lambda and the script both enforce
// it independently.
const BOUNDS = {
	collectSec: { min: 15, max: 3600, label: "Sample interval" },
	uploadSec: { min: 60, max: 3600, label: "Upload interval" },
	retainDays: { min: 1, max: 30, label: "Local retention" },
};

const DEFAULTS = {
	enabled: true,
	uploadMode: "timer",
	collectSec: 60,
	uploadSec: 300,
	retainDays: 2,
};

// Presets, in seconds. The longest is capped by MAX_METRICS_RANGE_SEC in
// InstanceMetricsData.ts — the backend rejects anything wider.
const RANGE_SECONDS = {
	"1h": 3600,
	"6h": 6 * 3600,
	"12h": 12 * 3600,
	"24h": 24 * 3600,
	"3d": 3 * 24 * 3600,
	"7d": 7 * 24 * 3600,
	"14d": 14 * 24 * 3600,
};

// Beyond this, x-axis labels need a date to be readable; below it, the date is
// the same on every tick and only costs width.
const DATE_LABEL_THRESHOLD_SEC = 36 * 3600;

const pad2 = (n) => String(n).padStart(2, '0');

export default {
	components: {
		Checkbox,
		Dropdown,
		ValueInput,
		RefreshButton,
		DateTimePicker,
		Graph,
	},
	props: {
		selectedInstanceData: {
			type: Object,
			required: true
		},
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			// Nothing is known until a read succeeds. `saved`/`form` are seeded with
			// the default shape only so the v-model bindings have something to point
			// at — `loaded` is what decides whether any of it is shown, because a
			// plausible-looking default is worse here than an admitted blank.
			loaded: false,
			loadError: null,
			saved: { ...DEFAULTS },
			form: { ...DEFAULTS },
			actual: null,
			drift: false,
			installed: null,
			// Whether a config has ever been saved for this instance, as opposed to
			// the API handing back defaults so there is something to edit. Null until
			// a read succeeds, for the same reason `installed` is.
			configured: null,
			// Result of the most recent upload selftest, or null if it hasn't been
			// run this session. Never seeded — an untested collector and a passing
			// one must not look alike.
			selftestResult: null,
			// The sample series for the selected window, exactly as the API returned
			// it. Null until a read succeeds, so "not fetched yet" and "fetched, no
			// samples" stay distinguishable — the second is a real finding about the
			// instance, the first is nothing at all.
			metrics: null,
			metricsError: null,
			// Monotonic per-fetch token; see fetchMetrics.
			metricsRequestId: 0,
			// Which of the two collected memory figures the memory graph plots.
			// Purely a display choice — both ride on every point, so switching
			// costs no fetch.
			memoryUnit: "percent",
			// One window for every graph in the section.
			range: {
				preset: "6h",
				// Local "YYYY-MM-DD HH:mm:ss", the shape DateTimePicker binds to.
				// Seeded from the current preset the first time custom is chosen.
				customStart: null,
				customEnd: null,
			},
			loading: {
				fetch: false,
				save: false,
				upload: false,
				selftest: false,
				metrics: false,
			},
			uploadModeOptions: [
				{ id: "timer", text: "On a schedule" },
				{ id: "manual", text: "When triggered" },
			],
			memoryUnitOptions: [
				{ id: "percent", text: "%" },
				{ id: "mb", text: "MB" },
			],
			rangeOptions: [
				{ id: "1h", text: "Last hour" },
				{ id: "6h", text: "Last 6 hours" },
				{ id: "12h", text: "Last 12 hours" },
				{ id: "24h", text: "Last 24 hours" },
				{ id: "3d", text: "Last 3 days" },
				{ id: "7d", text: "Last 7 days" },
				{ id: "14d", text: "Last 14 days" },
				{ id: "custom", text: "Custom range" },
			],
		}
	},
	computed: {
		metricPoints() {
			return this.metrics?.points ?? [];
		},
		// A single point has no line to draw and gives the graph a zero-width x
		// range, so the placeholder is the honest rendering of it.
		hasMetricData() {
			return this.metricPoints.length >= 2;
		},
		// `group` comes from the backend and increments across a gap in the samples,
		// so the line breaks over a window the instance was stopped rather than
		// drawing a straight edge across it as though the data were continuous.
		// Groups are per-line, so a second series has to be offset past the first
		// one's groups or the two would be stroked as one path.
		groupOffset() {
			return this.metricPoints.reduce((max, point) => Math.max(max, point.group), 0) + 1;
		},
		// Two lines: the bucket average and the bucket peak. Once the window is wide
		// enough to bucket, the average alone hides exactly the spikes worth looking
		// for — a minute at 100% inside a 30-minute bucket reads as 3%.
		cpuPoints() {
			return [
				...this.metricPoints.map((point) => ({ x: point.t, y: point.cpu, group: point.group, series: "avg" })),
				...this.metricPoints.map((point) => ({ x: point.t, y: point.cpuMax, group: point.group + this.groupOffset, series: "max" })),
			];
		},
		// Only one line: memory is a level, not a rate, so it doesn't spike between
		// samples the way CPU does and a peak series would sit on top of the average.
		// Which of the two collected figures it plots is the tile's toggle; they're
		// the same series scaled by MemTotal, so the shape never changes — only the
		// axis, which is why nothing else here has to care.
		memoryPoints() {
			const key = this.memoryUnit === "mb" ? "memMb" : "mem";
			return this.metricPoints.map((point) => ({ x: point.t, y: point[key], group: point.group, series: "avg" }));
		},
		// Peak drawn thinner and dimmer than the average: the two lines converge at
		// the natural resolution (one sample per bucket makes them identical), so
		// the average has to stay readable underneath.
		seriesConfig() {
			return {
				// theme.css --color-teal-4 / --color-yellow-2. Literals because the
				// canvas takes a color string, not a CSS class.
				avg: { color: "#6dbcb0", lineWeight: 2, label: "avg" },
				max: { color: "hsl(36, 99%, 64%)", lineWeight: 1, label: "peak" },
			};
		},
		emptyGraphText() {
			if (this.loading.metrics) return "Loading…";
			if (this.metricsError) return "No data";
			if (!this.metrics) return "No data loaded";
			if (this.metricPoints.length === 0) return "No samples in this range";
			return "Not enough samples to plot";
		},
		// Shared by every graph so they stay legible against each other, and so the
		// label density follows the window rather than being fixed.
		graphAxesConfig() {
			return {
				xAxisFormat: (val) => this.formatTimestamp(val),
				yAxisFormat: (val) => `${Number(val.toFixed(1))}%`,
				minXAxisMarkDistance: 200,
				// Widened for BOTH graphs when the memory graph is in MB, not just
				// for the one that needs it: a four- or five-digit MB label runs past
				// the default 40px gutter and gets clipped at the canvas edge, but
				// giving only the memory graph more room would shift its plot area
				// relative to the CPU graph beside it — and the whole point of the
				// shared window is that the two line up.
				leftBuffer: this.memoryUnit === "mb" ? 60 : 40,
			};
		},
		// The memory graph's y-axis is the only thing the unit toggle changes about
		// how the graphs are drawn; everything else is shared so the pair stays
		// readable against each other.
		memoryAxesConfig() {
			if (this.memoryUnit !== "mb") return this.graphAxesConfig;

			return {
				...this.graphAxesConfig,
				yAxisFormat: (val) => `${Math.round(val)} MB`,
			};
		},
		metricsSummary() {
			if (!this.metrics || this.metricPoints.length === 0) return "";

			const peakCpu = Math.max(...this.metricPoints.map((point) => point.cpuMax));
			const peakMemPoint = this.metricPoints.reduce((peak, point) => (point.mem > peak.mem ? point : peak));

			const parts = [
				`${this.metricPoints.length} point${this.metricPoints.length === 1 ? "" : "s"}`,
				`peak CPU ${peakCpu}%`,
				`peak memory ${peakMemPoint.mem}% (${peakMemPoint.memMb} MB)`,
			];

			// Points are averaged into buckets once the window is wider than the
			// point budget; saying so keeps a smoothed spike from being read as the
			// real peak. The peaks above are computed from cpuMax, which isn't.
			if (this.metrics.bucketSec > 1) {
				parts.push(`${this.metrics.bucketSec}s resolution`);
			}

			// The right-hand edge of the graph is the last UPLOAD, not the last
			// sample taken — under manual upload mode those can be days apart.
			if (this.metrics.lastSampleAt) {
				parts.push(`latest sample ${new Date(this.metrics.lastSampleAt * 1000).toLocaleString()}`);
			}

			return parts.join(" · ");
		},
		instanceOnline() {
			return this.selectedInstanceData.state === 'ONLINE';
		},
		// The parent serves a placeholder with state "UNKNOWN" until the status
		// fetch lands, so for that window "not ONLINE" and "offline" are different
		// claims. Asserting offline there is the same confident-but-wrong reporting
		// the load guard exists to prevent — and unlike the config, this one
		// resolves on its own a moment later.
		instanceStateKnown() {
			return Boolean(this.selectedInstanceData.state) && this.selectedInstanceData.state !== 'UNKNOWN';
		},
		// Enabled on the box, but systemd has no future elapse for the collect
		// timer — it will never run again without an apply. `enabled` and `active`
		// are both true in this state, which is what let it go unnoticed.
		stalled() {
			return Boolean(this.actual) && this.actual.enabled && this.actual.scheduled === false;
		},
		isShuttingDown() {
			return Boolean(this.selectedInstanceData.shutdown?.active);
		},
		canEdit() {
			// Same reasoning as the stopped-instance case this already covers: an apply has to reach
			// the box over SSM, and one that "succeeded" against a machine that is seconds from losing
			// power would leave the stored config describing a state nothing is running.
			return this.loaded && this.instanceOnline && !this.isShuttingDown && this.$checkPermissions(PERMISSIONS.instance.metrics.write);
		},
		// Whether the form differs from the last known-applied config, i.e. whether
		// there is anything to save or discard. The numeric fields come back off
		// ValueInput as strings, so a plain deep-compare would report a change as
		// soon as one is touched — compare them the same way `save` sends them.
		hasChanges() {
			if (!this.loaded) return false;
			if (Boolean(this.form.enabled) !== Boolean(this.saved.enabled)) return true;
			if (this.form.uploadMode !== this.saved.uploadMode) return true;
			return ["collectSec", "uploadSec", "retainDays"].some(
				(key) => Number(this.form[key]) !== Number(this.saved[key])
			);
		},
		lastUploadText() {
			// The script reports epoch seconds, and 0 for "the uploader has never run
			// on this boot" — which is the normal state on a freshly started box.
			if (!this.actual?.lastUploadAt) return "never";
			return new Date(this.actual.lastUploadAt * 1000).toLocaleString();
		},
		summaryText() {
			if (!this.loaded) return "Unknown";
			if (this.installed === false) return "Not installed";
			// Below `installed`: a verified "not installed" is the stronger, more
			// specific fact. This one only says nothing was ever saved, which on the
			// cheap read is all that can be known.
			if (this.configured === false) return "Not configured";
			if (!this.saved.enabled) return "Off";

			const upload = this.saved.uploadMode === 'manual'
				? "manual uploads"
				: `${this.saved.uploadSec}s auto uploads`;

			return `Enabled (${this.saved.collectSec}s sampling, ${upload})`;
		}
	},
	methods: {
		applyResponse(response) {
			// Guard against a 200 that isn't the shape we expect (a proxy or a
			// misrouted gateway can return one), which would otherwise leave the tile
			// claiming to know a config it never received.
			if (!response || typeof response.config !== "object" || response.config === null) {
				throw new Error("The API returned an unexpected response");
			}

			this.saved = { ...response.config };
			this.resetForm();
			this.loaded = true;
			this.loadError = null;

			if (response.configured !== undefined) {
				this.configured = response.configured === true;
			}

			if (response.actual !== undefined) {
				this.actual = response.actual;
				this.drift = response.drift === true;
				// `unreachable` covers offline/warming-up boxes, which say nothing
				// about whether the collector is installed — only a status that came
				// back and reported false does. Null means "still unknown". The one
				// exception is the reason that IS an answer: a box that exits 127
				// before printing a status line has no collector on it.
				if (response.actual) {
					this.installed = response.actual.installed;
				} else {
					this.installed = response.unreachable === "collector-not-installed" ? false : null;
				}
			}
		},

		// Drops every value back to unknown. Called whenever a read fails, so a
		// failed refresh can't leave the previous read on screen looking current.
		invalidate(message) {
			this.loaded = false;
			this.loadError = message;
			this.actual = null;
			this.drift = false;
			this.installed = null;
			this.configured = null;
		},

		resetForm() {
			this.form = { ...this.saved };
		},

		validate() {
			for (const [key, bounds] of Object.entries(BOUNDS)) {
				const value = Number(this.form[key]);
				if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
					this.$alert.error(`${bounds.label} must be a whole number between ${bounds.min} and ${bounds.max}`);
					return false;
				}
			}
			return true;
		},

		// The default read is a plain database lookup and costs the instance
		// nothing; verify=true is what actually goes and asks the box, so it's
		// reserved for an explicit refresh.
		async fetchConfig(verify = false) {
			this.$validatePermissions(PERMISSIONS.instance.metrics.read);

			// This tile is the only one that fetches on mount, so it is the only one
			// that can run before the parent has an instance to describe. Without
			// this the URL would interpolate "undefined" and come back as a confusing
			// 404 that looks like a broken route.
			if (!this.selectedInstanceData.id) {
				this.invalidate("No instance is selected yet.");
				return;
			}

			if (this.loading.fetch) return;
			this.loading.fetch = true;

			try {
				const query = verify ? "?verify=true" : "";
				const response = await get(
					`/instance/${this.selectedInstanceData.id}/metrics/config${query}`,
					PERMISSIONS.instance.metrics.read
				);
				this.applyResponse(response);
			} catch (e) {
				this.invalidate(e.message || "The request failed.");
				this.$alert.error("Error fetching metrics configuration");
				console.error(e);
			} finally {
				this.loading.fetch = false;
			}
		},

		refresh() {
			this.fetchConfig(this.instanceOnline);
		},

		// Epoch seconds -> the local "YYYY-MM-DD HH:mm:ss" string DateTimePicker
		// binds to. Built by hand rather than sliced out of toISOString(), which
		// would hand the picker a UTC wall-clock time under a local-time label.
		toPickerValue(epochSec) {
			const date = new Date(epochSec * 1000);
			return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
				+ `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
		},

		// The inverse. The picker's value has no zone marker, so replacing the space
		// with a T gives a string the Date constructor reads as local time — which
		// is what the user typed.
		fromPickerValue(value) {
			if (typeof value !== "string" || !value) return null;
			const parsed = new Date(value.replace(" ", "T"));
			return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000);
		},

		// Resolves the range controls into an epoch-second window. Presets are
		// relative to now, so this is recomputed per fetch rather than stored.
		resolveRange() {
			if (this.range.preset === "custom") {
				const start = this.fromPickerValue(this.range.customStart);
				const end = this.fromPickerValue(this.range.customEnd);
				if (start === null || end === null) return null;
				return { start, end };
			}

			const end = Math.floor(Date.now() / 1000);
			const span = RANGE_SECONDS[this.range.preset] ?? RANGE_SECONDS["6h"];
			return { start: end - span, end };
		},

		// Adaptive because one formatter serves both the axis labels and the hover
		// readout: over a week the date is what identifies a tick, over an hour it
		// is the same on every one of them.
		formatTimestamp(epochSec) {
			const date = new Date(Math.floor(epochSec) * 1000);
			const span = this.metrics ? this.metrics.end - this.metrics.start : 0;

			if (span > DATE_LABEL_THRESHOLD_SEC) {
				return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
			}
			return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		},

		async fetchMetrics() {
			this.$validatePermissions(PERMISSIONS.instance.metrics.read);

			if (!this.selectedInstanceData.id) return;

			const bounds = this.resolveRange();
			if (!bounds) {
				this.metricsError = "Pick a start and end time.";
				return;
			}
			if (bounds.start >= bounds.end) {
				this.metricsError = "The start time must be earlier than the end time.";
				return;
			}

			// A read can span several seconds of S3 fetches, which is long enough for
			// the selected instance or the range to change under it. Without a
			// sequence check the slower of two overlapping reads wins and the graph
			// ends up describing a window nothing on screen is asking for. Claimed
			// only once the request is actually going out, so a rejected range can't
			// orphan an in-flight one.
			const requestId = ++this.metricsRequestId;
			const isCurrent = () => requestId === this.metricsRequestId;

			this.loading.metrics = true;
			this.metricsError = null;

			try {
				const response = await get(
					`/instance/${this.selectedInstanceData.id}/metrics?start=${bounds.start}&end=${bounds.end}`,
					PERMISSIONS.instance.metrics.read
				);

				if (!response || !Array.isArray(response.points)) {
					throw new Error("The API returned an unexpected response");
				}

				if (!isCurrent()) return;
				this.metrics = response;
			} catch (e) {
				if (!isCurrent()) return;
				// Cleared rather than kept: the range control now says one thing and the
				// graph would be showing another.
				this.metrics = null;
				this.metricsError = e.message || "Could not load metrics.";
				this.$alert.error(this.metricsError);
				console.error(e);
			} finally {
				if (isCurrent()) {
					this.loading.metrics = false;
				}
			}
		},

		async save() {
			this.$validatePermissions(PERMISSIONS.instance.metrics.write);

			if (!this.loaded) return;
			if (!this.validate()) return;
			if (this.loading.save) return;
			this.loading.save = true;

			try {
				const response = await put(
					`/instance/${this.selectedInstanceData.id}/metrics/config`,
					PERMISSIONS.instance.metrics.write,
					{
						enabled: this.form.enabled,
						uploadMode: this.form.uploadMode,
						collectSec: Number(this.form.collectSec),
						uploadSec: Number(this.form.uploadSec),
						retainDays: Number(this.form.retainDays),
					}
				);
				this.applyResponse(response);
				this.drift = false;
				this.$alert.success("Metrics configuration applied");
			} catch (e) {
				this.$alert.error(e.message || "Error applying metrics configuration");
				console.error(e);
			} finally {
				this.loading.save = false;
			}
		},

		// Uploads a single probe object instead of the buffer, to prove the
		// uploader's request signing and the instance role's S3 access. Worth
		// having as its own action because the uploader signs its own SigV4
		// requests: a signing or IAM fault otherwise only shows up as a failed
		// timer run that nobody is watching. Touches neither the buffer nor the
		// upload stamp, so it's safe to run at any time.
		async runSelftest() {
			this.$validatePermissions(PERMISSIONS.instance.metrics.read);

			if (!this.loaded) return;
			if (this.loading.selftest) return;
			this.loading.selftest = true;

			// Cleared up front so a failed request can't leave the previous pass
			// sitting on screen as though it described this run.
			this.selftestResult = null;

			try {
				const response = await post(
					`/instance/${this.selectedInstanceData.id}/metrics/upload?selftest=true`,
					PERMISSIONS.instance.metrics.read
				);

				if (response?.actual) {
					this.actual = response.actual;
					this.installed = response.actual.installed;
				}

				this.selftestResult = {
					ok: true,
					message: "The instance signed and uploaded a probe object to S3 successfully.",
					at: new Date().toLocaleString(),
				};
				this.$alert.success("Metrics upload selftest passed");
			} catch (e) {
				// The backend turns a failed probe into a 409 carrying the reason
				// (SELFTEST_FAILED), so e.message is the diagnostic rather than a
				// generic failure string.
				// Not a probe result: there was nothing on the box to run it. Recording
				// it as a failed selftest would read as "signing is broken".
				if (e.code === "COLLECTOR_NOT_INSTALLED") {
					this.installed = false;
					this.$alert.error(e.message);
					return;
				}

				this.selftestResult = {
					ok: false,
					message: e.message || "The selftest failed without reporting a reason.",
					at: new Date().toLocaleString(),
				};
				this.$alert.error(`Metrics upload selftest failed: ${e.message || "no reason reported"}`);
				console.error(e);
			} finally {
				this.loading.selftest = false;
			}
		},

		async uploadNow() {
			this.$validatePermissions(PERMISSIONS.instance.metrics.read);

			if (!this.loaded) return;
			if (this.loading.upload) return;
			this.loading.upload = true;

			try {
				const response = await post(
					`/instance/${this.selectedInstanceData.id}/metrics/upload`,
					PERMISSIONS.instance.metrics.read
				);
				this.actual = response?.actual ?? null;
				this.installed = this.actual ? this.actual.installed : null;
				this.$alert.success("Metrics uploaded");
			} catch (e) {
				// The buffered-hours and last-upload figures describe a moment that
				// hasn't resolved; keeping them on screen would misreport them as
				// post-upload numbers either way.
				this.actual = null;

				// The upload outran the poll budget but is still running on the box.
				// Not an error — reporting it as one invites a retry of work that is
				// about to finish on its own.
				if (e.code === "UPLOAD_STILL_RUNNING") {
					this.$alert.warning(e.message);
					return;
				}

				if (e.code === "COLLECTOR_NOT_INSTALLED") {
					this.installed = false;
				}

				this.$alert.error(e.message || "Error uploading metrics");
				console.error(e);
			} finally {
				this.loading.upload = false;
			}
		},
	},
	watch: {
		// The samples live in S3 keyed by instance, so switching instances has to
		// re-read them — nothing about the previous instance's series applies.
		'selectedInstanceData.id'(id, previous) {
			if (!id || id === previous) return;
			this.metrics = null;
			this.metricsError = null;
			if (this.$checkPermissions(PERMISSIONS.instance.metrics.read)) {
				this.fetchMetrics();
			}
		},

		'range.preset'(preset) {
			if (preset === "custom") {
				// Seeded from the window currently on screen so the pickers open on
				// something meaningful, and set BEFORE they render: DateTimePicker
				// fills an empty value with "now" on creation, which would otherwise
				// give both fields the same time and an empty range.
				const bounds = this.metrics
					? { start: this.metrics.start, end: this.metrics.end }
					: this.resolveRange();
				if (bounds) {
					this.range.customStart = this.toPickerValue(bounds.start);
					this.range.customEnd = this.toPickerValue(bounds.end);
				}
				// No fetch here — the APPLY button is what commits a custom range.
				return;
			}

			this.fetchMetrics();
		},
	},
	mounted() {
		// Gated on read specifically, not read-or-write: the tile is visible to
		// either, but fetchConfig's validator throws (and alerts) rather than
		// returning false, so a write-only user would get an uncaught error on
		// mount. They see the unknown state instead, which is accurate — the
		// backend wouldn't serve them the config either.
		if (this.$checkPermissions(PERMISSIONS.instance.metrics.read)) {
			this.fetchConfig(false);
			// Independent of the config read: the samples are in S3 either way, so a
			// box whose collector is off still has whatever history it collected.
			this.fetchMetrics();
		} else {
			this.invalidate("You don't have permission to read the metrics configuration.");
		}
	}
}
</script>

<style scoped>
.metrics-config-grid {
	grid-template-columns: auto auto;
}
</style>
