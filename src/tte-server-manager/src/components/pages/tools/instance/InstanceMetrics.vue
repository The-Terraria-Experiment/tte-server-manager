<template>
	<StatusTile
		:perm-required="[PERMISSIONS.instance.metrics.read, PERMISSIONS.instance.metrics.write]"
		match-any-permission
		collapsible
		class="mt-2"
		:loading="loading.fetch || loading.save || loading.upload || loading.selftest"
	>
		<template #header>
			<Icon icon="gauge" color="text-gray-6" size="5" />
			<p class="text-gray-6 ml-2 text-lg">Metrics Collector</p>
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
					<p class="font-main font-bold text-yellow-2">
						{{ loading.fetch ? "Reading the metrics configuration..." : "The metrics configuration couldn't be read, so none of it is shown." }}
					</p>
					<p v-if="loadError && !loading.fetch" class="font-main font-semibold text-gray-7 mt-2">
						{{ loadError }}
					</p>
				</div>

				<template v-else>
					<p v-if="!instanceOnline" class="font-main font-bold text-yellow-2 mb-4">
						The instance is offline. Settings are shown as last applied and can't be changed until it starts.
					</p>

					<p v-if="drift" class="font-main font-bold text-yellow-2 mb-4">
						The instance isn't running the saved configuration. Save again to re-apply it.
					</p>

					<div class="grid metrics-config-grid w-max max-w-full gap-x-4 gap-y-3 items-center">
						<p class="font-main font-bold text-teal-5">Collection</p>
						<div class="flex items-center">
							<Checkbox
								class="h-5 w-5"
								:value="form.enabled"
								:disabled="!canEdit"
								@input="form.enabled = !form.enabled"
							/>
							<p class="font-main font-semibold text-white-0 ml-2">
								{{ form.enabled ? "Enabled" : "Disabled" }}
							</p>
						</div>

						<p class="font-main font-bold text-teal-5">Sample every</p>
						<div class="flex items-center">
							<ValueInput
								type="number"
								v-model="form.collectSec"
								:disabled="!canEdit || !form.enabled"
								class="w-28"
							/>
							<p class="font-main font-semibold text-gray-7 ml-2">seconds</p>
						</div>

						<p class="font-main font-bold text-teal-5">Upload</p>
						<div class="flex items-center">
							<Dropdown
								:options="uploadModeOptions"
								v-model="form.uploadMode"
								:disabled="!canEdit || !form.enabled"
								inputClass="bg-gray-5 text-white-0 w-56"
							/>
						</div>

						<p v-if="form.uploadMode === 'timer'" class="font-main font-bold text-teal-5">Upload every</p>
						<div v-if="form.uploadMode === 'timer'" class="flex items-center">
							<ValueInput
								type="number"
								v-model="form.uploadSec"
								:disabled="!canEdit || !form.enabled"
								class="w-28"
							/>
							<p class="font-main font-semibold text-gray-7 ml-2">seconds</p>
						</div>

						<p class="font-main font-bold text-teal-5">Keep locally</p>
						<div class="flex items-center">
							<ValueInput
								type="number"
								v-model="form.retainDays"
								:disabled="!canEdit || !form.enabled"
								class="w-28"
							/>
							<p class="font-main font-semibold text-gray-7 ml-2">days</p>
						</div>
					</div>

					<p v-if="form.uploadMode === 'manual'" class="font-main font-semibold text-gray-7 mt-4 max-w-2xl">
						In manual mode nothing is uploaded on a schedule. Samples reach S3 when the instance shuts down, or
						when you upload now. Between those points they exist only on the instance's disk.
					</p>

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

				<div class="flex flex-wrap justify-end w-full mt-6 gap-4">
					<FlexButton
						v-if="$checkPermissions(PERMISSIONS.instance.metrics.read)"
						:variant="BTN_VARIANT.SECONDARY"
						:disabled="loading.fetch"
						@input="refresh"
					>
						<p class="font-main font-bold py-2 px-8 md:px-12">{{ loaded ? "REFRESH" : "RETRY" }}</p>
					</FlexButton>
					<FlexButton
						v-if="loaded && instanceOnline && $checkPermissions(PERMISSIONS.instance.metrics.read)"
						:variant="BTN_VARIANT.SECONDARY"
						:disabled="loading.selftest"
						@input="runSelftest"
					>
						<p class="font-main font-bold py-2 px-8 md:px-12">SELF-TEST</p>
					</FlexButton>
					<FlexButton
						v-if="loaded && instanceOnline && $checkPermissions(PERMISSIONS.instance.metrics.read)"
						:variant="BTN_VARIANT.SECONDARY"
						:disabled="loading.upload"
						@input="uploadNow"
					>
						<p class="font-main font-bold py-2 px-8 md:px-12">UPLOAD NOW</p>
					</FlexButton>
					<FlexButton
						v-if="canEdit"
						:variant="BTN_VARIANT.DANGER"
						:disabled="loading.save"
						@input="resetForm"
					>
						<p class="font-main font-bold py-2 px-8 md:px-12">DISCARD</p>
					</FlexButton>
					<FlexButton
						v-if="canEdit"
						:variant="BTN_VARIANT.PRIMARY"
						:disabled="loading.save"
						@input="save"
					>
						<p class="font-main font-bold py-2 px-8 md:px-12">SAVE</p>
					</FlexButton>
				</div>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { get, post, put } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Checkbox from '../../../common/Checkbox.vue';
import Dropdown from '../../../common/Dropdown.vue';
import ValueInput from '../../../common/ValueInput.vue';

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

export default {
	components: {
		Checkbox,
		Dropdown,
		ValueInput,
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
			// Result of the most recent upload selftest, or null if it hasn't been
			// run this session. Never seeded — an untested collector and a passing
			// one must not look alike.
			selftestResult: null,
			loading: {
				fetch: false,
				save: false,
				upload: false,
				selftest: false,
			},
			uploadModeOptions: [
				{ id: "timer", text: "On a schedule" },
				{ id: "manual", text: "Only when triggered" },
			],
		}
	},
	computed: {
		instanceOnline() {
			return this.selectedInstanceData.state === 'ONLINE';
		},
		canEdit() {
			return this.loaded && this.instanceOnline && this.$checkPermissions(PERMISSIONS.instance.metrics.write);
		},
		lastUploadText() {
			// The script reports epoch seconds, and 0 for "the uploader has never run
			// on this boot" — which is the normal state on a freshly started box.
			if (!this.actual?.lastUploadAt) return "never";
			return new Date(this.actual.lastUploadAt * 1000).toLocaleString();
		},
		summaryText() {
			if (!this.loaded) return this.loading.fetch ? "CHECKING..." : "UNKNOWN";
			if (this.installed === false) return "NOT INSTALLED";
			if (!this.saved.enabled) return "OFF";

			const upload = this.saved.uploadMode === 'manual'
				? "manual uploads"
				: `uploads every ${this.saved.uploadSec}s`;

			return `ON — every ${this.saved.collectSec}s, ${upload}`;
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

			if (response.actual !== undefined) {
				this.actual = response.actual;
				this.drift = response.drift === true;
				// `unreachable` covers offline/warming-up boxes, which say nothing
				// about whether the collector is installed — only a status that came
				// back and reported false does. Null means "still unknown".
				this.installed = response.actual ? response.actual.installed : null;
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
				// just failed to happen; keeping them on screen would misreport them
				// as post-upload numbers.
				this.actual = null;
				this.$alert.error(e.message || "Error uploading metrics");
				console.error(e);
			} finally {
				this.loading.upload = false;
			}
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
