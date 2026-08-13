<template>
	<div>
		<StatusTile
			class="grow gradient-tile"
			collapsible
			:perm-required="PERMISSIONS.server.world.create"
		>
			<template #header>
				<Icon icon="earth" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Create World</p>
			</template>
			<!-- <template #summary>
				<p class="text-2xl text-teal-4">{{ mainText }}</p>
			</template> -->
			<template #content v-if="worldLaunchInProgress">
				<div class="p-5 flex flex-col justify-between h-full">
					<div class="flex items-center justify-center">
						<Spinner class="h-5 w-5 text-teal-4" />
						<p class="font-main font-bold text-gray-9 ml-3">World launch in progress</p>
					</div>
				</div>
			</template>
			<template #content v-else-if="worldCreationInProgress && !worldCreatePopupOpen">
				<div class="p-5 flex flex-col justify-between h-full">
					<div>
						<div class="flex items-center justify-center mb-4">
							<Spinner class="h-5 w-5 text-teal-4" />
							<p class="font-main font-bold text-teal-5 ml-3">{{ worldCreateStageLabel }}</p>
						</div>
						<p class="font-main text-gray-9 text-sm sm:text-base text-center"><span class="font-bold">Stage:</span> {{ worldCreateStepLabel }}</p>
						<p v-if="lastWorldCreateStatus.detail" class="font-mono text-teal-4 text-xs mt-3 text-center break-all">{{ lastWorldCreateStatus.detail }}</p>
						<p v-if="lastWorldCreateStatus.progress >= 0" class="font-mono text-gray-8 text-xs mt-3 text-center">Progress: {{ lastWorldCreateStatus.progress }}%</p>
						<p class="font-mono text-gray-8 text-xs mt-3 text-center">Initiated by: {{ lastWorldCreateStatus.requestedBy || "(?)" }}</p>
					</div>
				</div>
			</template>
			<template #content v-else>
				<p class="font-main font-bold text-gray-7 px-5">WORLD OPTIONS</p>
				<div class="mb-4 mt-1 rounded-lg flex flex-col sm:grid grid-cols-3 gap-4 mx-4">
					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">World Size</p>
						<Dropdown
							inputClass="bg-teal-3 text-white-1"
							iconColor="text-white-1"
							:options="worldSizeDropdownOptions"
							v-model="newWorldData.size"
						/>
					</div>
					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">World Evil</p>
						<Dropdown
							inputClass="bg-teal-3 text-white-1"
							iconColor="text-white-1"
							:options="worldEvilDropdownOptions"
							v-model="newWorldData.evil"
						/>
					</div>
					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">Difficulty</p>
						<Dropdown
							inputClass="bg-teal-3 text-white-1"
							iconColor="text-white-1"
							:options="difficultyDropdownOptions"
							v-model="newWorldData.difficulty"
						/>
					</div>
					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">World Name</p>
						<ValueInput
							placeholder="World name"
							v-model="newWorldData.name"
						/>
					</div>
					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">World File Location</p>
						<Dropdown
							inputClass="bg-teal-3 text-white-1"
							iconColor="text-white-1"
							:options="worldFileLocationOptions"
							v-model="newWorldData.worldFileLocation"
						/>
					</div>
					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">World Seed</p>
						<ValueInput
							placeholder="Seed value"
							maxlength="50"
							v-model="newWorldData.seed"
						/>
					</div>
					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">Max Players</p>
						<ValueInput
							type="number"
							max="500"
							min="1"
							placeholder="Value between 1 and 500"
							v-model="newWorldData.maxPlayers"
						/>
					</div>
					<div class="bg-gray-5 rounded-lg p-4 flex flex-col">
						<p class="font-mono font-semibold text-teal-6 mb-2">Password</p>
						<ValueInput
							maxlength="25"
							placeholder="Leave blank to use config file"
							v-model="newWorldData.password"
							:input-allowed="new Set(allowedPasswordChars)"
						/>
					</div>
				</div>
				<div class="flex justify-end p-4">
					<FlexButton
						v-if="!serverStore.loading.worldLaunch[selectedInstance]"
						:variant="BTN_VARIANT.PRIMARY"
						@input="createWorld"
						:disabled="isShuttingDown || !(newWorldData.name && newWorldData.maxPlayers && newWorldData.worldFileLocation)"
					>
						<p class="font-main font-bold py-2 px-4 md:px-10">CREATE & LAUNCH WORLD</p>
					</FlexButton>
					<div v-else class="flex items-center">
						<Spinner class="h-5 w-5 text-teal-3" />
						<p class="font-main font-bold text-teal-4 mx-2">CREATING WORLD...</p>
					</div>
				</div>
			</template>
		</StatusTile>
		<Popup
			:open="worldCreatePopupOpen"
			xDisabled
			headerText="Creating & Launching World"
			bodyClass="w-[95%] sm:w-[34rem] h-[18rem]"
		>
			<div class="p-5 flex flex-col justify-between h-full">
				<div>
					<div class="flex items-center justify-center mb-4">
						<Spinner class="h-5 w-5 text-teal-4" />
						<p class="font-main font-bold text-teal-5 ml-3">{{ worldCreateStageLabel }}</p>
					</div>
					<p class="font-main text-gray-9 text-sm sm:text-base text-center"><span class="font-bold">Stage:</span> {{ worldCreateStepLabel }}</p>
					<!-- <p v-if="lastWorldCreateStatus.progress >= 0" class="font-mono text-gray-8 text-xs mt-3 text-center">Progress: {{ lastWorldCreateStatus.progress }}%</p> -->
					<p v-if="lastWorldCreateStatus.detail" class="font-mono text-xs mt-3 text-center break-all">Status: {{ lastWorldCreateStatus.detail }}</p>
				</div>
			</div>
		</Popup>
	</div>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { TASK_IDS, useStatusStore } from '../../../../stores/statusStore';
import { post } from '../../../../util/api';
import delay from '../../../../util/delay';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Dropdown from "../../../common/Dropdown.vue";
import Popup from "../../../common/Popup.vue";

const defaultNewWorldData = () => ({
	size: 1,
	difficulty: 3,
	evil: 1,
	name: "",
	seed: "fortheworthy",
	maxPlayers: 16,
	port: 7777,
	password: "",
	worldFileLocation: null
});

// Stable across remounts, so a re-registered handler replaces its predecessor instead of stacking.
const POLL_HANDLER_ID = "create-world-poll-status";
const FINISH_HANDLER_ID = "create-world-handle-finished";

const defaultLastWorldCreateStatus = () => ({
	requestedBy: null,
	status: "",
	step: "",
	progress: -1,
	detail: null,
	failureReason: null,
	abandoned: false,
	createdAt: null,
	updatedAt: null,
	jobID: null
});

export default {
	mixins: [],
	components: {
		Popup,
		Dropdown,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			statusStore: useStatusStore(),
			newWorldData: defaultNewWorldData(),
			allowedPasswordChars: [
				...Array.from({ length: 26 }).map((_, i) => String.fromCharCode(97 + i)),
				...Array.from({ length: 26 }).map((_, i) => String.fromCharCode(65 + i)),
				...Array.from({ length: 10 }).map((_, i) => i.toString()),
				'_'
			],
			worldSizeDropdownOptions: [
				{ id: 1, text: "Small" },
				{ id: 2, text: "Medium" },
				{ id: 3, text: "Large" },
			],
			worldEvilDropdownOptions: [
				{ id: 1, text: "Random" },
				{ id: 2, text: "Corruption" },
				{ id: 3, text: "Crimson" },
			],
			difficultyDropdownOptions: [
				{ id: 4, text: "Journey" },
				{ id: 1, text: "Classic" },
				{ id: 2, text: "Expert" },
				{ id: 3, text: "Master" },
			],
			worldCreatePopupOpen: false,
			// Set by whoever stops the polling so handleCreationFinished — which runs off the
			// task-end subscription and owns the teardown — can report the real reason instead of
			// both of them alerting about the same stop.
			worldCreateEndMessage: null,
		}
	},
	computed: {
		/**
		 * Read from the store rather than held locally, so a creation started by another operator (which
		 * arrives as a `world.create` socket event) drives this component's display and the launch guard
		 * in SelectWorld identically to one started here.
		 */
		lastWorldCreateStatus() {
			return this.serverStore.getWorldCreateStatus(this.selectedInstance) ?? defaultLastWorldCreateStatus();
		},
		worldFileLocationOptions() {
			const worldPathNicknames = this.serverStore.instanceWorldPaths[this.selectedInstance] ?? [];
			const worldRoots = worldPathNicknames.filter(pname => this.$checkResourceAccess(`filepath::${this.selectedInstance}::${pname}`));
			return worldRoots.map(r => ({ id: r, text: r }));
		},
		worldCreateStageLabel() {
			if (this.lastWorldCreateStatus.status === "completed") return "World Created";
			if (this.lastWorldCreateStatus.status === "failed") return "World Creation Failed";
			if (this.lastWorldCreateStatus.status === "queued") return "Queued";
			return "Working";
		},
		worldCreateStepLabel() {
			if (this.lastWorldCreateStatus.step === "preparing-instance") return "Launching Instance";
			if (this.lastWorldCreateStatus.step === "queued") return "Queued";
			if (this.lastWorldCreateStatus.step === "starting-tshock") return "Starting TShock";
			if (this.lastWorldCreateStatus.step === "waiting-for-world-file") return "Generating world file";
			if (this.lastWorldCreateStatus.step === "uploading-world-file") return "Uploading world file";
			if (this.lastWorldCreateStatus.step === "completed") return "Launching world";
			return "World creation started";
		},
		worldCreationInProgress() {
			return this.lastWorldCreateStatus.progress >= 0;
		},
		worldLaunchInProgress() {
			return this.serverStore.loading.worldLaunch[this.selectedInstance];
		},
		mainText() {
			return this.worldCreationInProgress ? "World creation in progress" : "World creation available";
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		isShuttingDown() {
			return this.serverStore.isShuttingDown(this.selectedInstance);
		}
	},
	methods: {
		openWorldCreatePopup() {
			this.worldCreatePopupOpen = true;
			this.worldCreateStatus = "queued";
		},
		closeWorldCreatePopup() {
			this.worldCreatePopupOpen = false;
		},
		async pollWorldCreateStatus() {
			if (!this.selectedInstance) {
				console.warn("Tried to poll creation status, but found no selected instance");
				return;
			}

			try {
				// The store owns the fetch and the state; this method still owns how each outcome is
				// reported, because a lost connection and a finished job need different alerts.
				const statusResult = await this.serverStore.fetchWorldCreateStatus(this.selectedInstance);

				if (!statusResult) {
					// The job row is gone — it finished and was cleaned up, or was replaced by a
					// newer request. Either way there's nothing left to watch, and continuing to
					// poll would keep the spinner up against a job that no longer exists.
					this.stopWorldCreatePolling();
					return;
				}

				if (statusResult.abandoned) {
					// The worker died without recording an outcome. The backend already treats this
					// job as replaceable, so say so rather than spinning until the poll cap.
					this.stopWorldCreatePolling("World creation stopped without finishing — the job is no longer running. You can start a new one.");
				}
			} catch (error) {
				console.error(error);
				this.stopWorldCreatePolling("Lost connection while tracking world creation status");
			}
		},
		stopWorldCreatePolling(message = null) {
			this.worldCreateEndMessage = message;
			this.statusStore.cancelRepeatingTask(TASK_IDS.CREATE_WORLD_CHECK);
		},
		startWorldCreatePolling(firstStatus, maxRepeats = 180) {
			this.worldCreateEndMessage = null;
			this.serverStore.setWorldCreateStatus(this.selectedInstance, firstStatus);
			// Poll every 5s. The window is deliberately generous (default ~15min) because a
			// cold start — booting the instance, SSM + TShock warmup, generating a large world,
			// then uploading it — can take several minutes before the job reports completion.
			this.statusStore.startRepeatingTask(TASK_IDS.CREATE_WORLD_CHECK, () => ["failed", "completed"].includes(this.lastWorldCreateStatus.status), 5000, maxRepeats);
		},
		async createWorld() {
			this.$validatePermissions(PERMISSIONS.server.world.create);

			if (this.serverStore.loading.worldLaunch[this.selectedInstance]) return;

			const conditions = [
				[this.newWorldData.size < 1 || this.newWorldData.size > 3, "Invalid world size"],
				[this.newWorldData.difficulty < 1 || this.newWorldData.difficulty > 4, "Invalid world difficulty"],
				[this.newWorldData.evil < 1 || this.newWorldData.evil > 3, "Invalid world evil"],
				[!this.newWorldData.name || !/^[a-zA-Z0-9_\s]+$/.test(this.newWorldData.name), "World name can only include alphanumeric characters, underscores, and whitespace"],
				[!this.newWorldData.maxPlayers, "Cannot have 0 max players"],
				[this.newWorldData.password && !/^[a-zA-Z0-9_]+$/.test(this.newWorldData.password), "The password can only contain alphanumeric characters and underscores"],
				[!this.newWorldData.worldFileLocation, "Invalid file location"]
			];

			for (let condition of conditions) {
				if (condition[0]) {
					this.$alert.error(condition[1]);
					return;
				}
			}

			this.newWorldData.name = this.newWorldData.name.replace(/\s/g, '_');
			this.serverStore.loading.worldLaunch[this.selectedInstance] = true;

			try {
				const queued = await post(`/server/${this.selectedInstance}/world/create`, PERMISSIONS.server.world.create, {
					port: this.newWorldData.port,
					maxPlayers: this.newWorldData.maxPlayers,
					password: this.newWorldData.password ?? "",
					size: this.newWorldData.size,
					difficulty: this.newWorldData.difficulty,
					evil: this.newWorldData.evil,
					seed: this.newWorldData.seed,
					worldName: this.newWorldData.name,
					worldFolderPath: this.newWorldData.worldFileLocation
				});

				this.openWorldCreatePopup();
				this.startWorldCreatePolling(defaultLastWorldCreateStatus());
			} catch (e) {
				// Note: don't clear the loading flag unconditionally here — the timeout branch
				// below keeps world creation "in progress" and hands off to status polling.
				if (e.status === 409) {
					// Someone else's job is genuinely still running (the backend only says this for a
					// job that's still heartbeating). Watching it is more useful than an error.
					this.$alert.warning("A world is already being created on this instance");
					this.openWorldCreatePopup();
					this.startWorldCreatePolling(defaultLastWorldCreateStatus());
				} else if (e.message.includes("Instances not in a valid state")) {
					this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
					this.$alert.warning("Could not create world: instance is not running or not responding");
				} else if (e.message.includes("Endpoint request timed out")) {
					// The instance was almost certainly off. Launching it (plus SSM + TShock warmup)
					// reliably takes longer than the 30s API Gateway timeout, so the POST times out
					// on our side even though the backend has accepted the job and is still working
					// on it. Switch to polling the job status endpoint — the same flow the success
					// path uses — instead of treating this as a failure.
					this.$alert.info("Instance is starting up — this can take a few minutes");
					this.openWorldCreatePopup();
					this.startWorldCreatePolling(defaultLastWorldCreateStatus());
				} else  {
					this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
					this.$alert.error("Error creating world");
					console.error(e);
				}
			}
		},
		async handleCreationFinished() {
			const endMessage = this.worldCreateEndMessage;
			this.worldCreateEndMessage = null;

			if (endMessage) {
				this.$alert.error(endMessage);
				this.closeWorldCreatePopup();
			} else if (this.lastWorldCreateStatus.status === "completed") {
				this.newWorldData = defaultNewWorldData();
				if (this.worldCreatePopupOpen) {
					this.$alert.success("World created, saved, and launched successfully");
				} else {
					this.$alert.info("World creation completed");
				}
				await delay(7000);
				this.$emit("refresh");
				await delay(1200);
				this.closeWorldCreatePopup();
			} else if (this.lastWorldCreateStatus.status === "failed") {
				// The backend records *why* it failed; the cases that matter (TShock never started,
				// world path not configured, ran out of time mid-generation) are indistinguishable
				// to a user without it.
				this.$alert.error(this.lastWorldCreateStatus.failureReason || "World creation failed");
				this.closeWorldCreatePopup();
			} else {
				// Polling stopped without the backend reporting a terminal state. The job is
				// most likely still running (slow cold start / large world) and we simply
				// stopped watching, so don't claim it failed — tell the user to check back.
				this.$alert.warning("World creation is taking longer than expected — check back in a few minutes");
				this.closeWorldCreatePopup();
			}

			this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
			// Clears the store entry, which also releases the cross-operator create/launch guard.
			this.serverStore.clearWorldCreateStatus(this.selectedInstance);
		}
	},
	created() {
		this.statusStore.subscribeToTask(TASK_IDS.CREATE_WORLD_CHECK, this.pollWorldCreateStatus, POLL_HANDLER_ID);
		this.statusStore.subscribeToTaskEnd(TASK_IDS.CREATE_WORLD_CHECK, this.handleCreationFinished, FINISH_HANDLER_ID);
	},
	beforeUnmount() {
		// Without this the previous instance's handlers keep running after a route change, so the
		// alerts land against a component that's no longer on screen — and multiply with each visit.
		this.statusStore.unsubscribeFromTask(TASK_IDS.CREATE_WORLD_CHECK, POLL_HANDLER_ID);
		this.statusStore.unsubscribeFromTaskEnd(TASK_IDS.CREATE_WORLD_CHECK, FINISH_HANDLER_ID);
	},
	watch: {
		worldFileLocationOptions(value) {
			if (value && value[0]) {
				this.newWorldData.worldFileLocation = value[0].id;
			}
		}
	}
}
</script>

<style scoped>

</style>
