<template>
	<StatusTile
		:perm-required="[PERMISSIONS.instance.metrics.read, PERMISSIONS.instance.metrics.write]"
		match-any-permission
		collapsible
		class="mt-2"
		:loading="loading.fetch || loading.save || loading.upload || loading.selftest"
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
		RefreshButton,
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
			loading: {
				fetch: false,
				save: false,
				upload: false,
				selftest: false,
			},
			uploadModeOptions: [
				{ id: "timer", text: "On a schedule" },
				{ id: "manual", text: "When triggered" },
			],
		}
	},
	computed: {
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
