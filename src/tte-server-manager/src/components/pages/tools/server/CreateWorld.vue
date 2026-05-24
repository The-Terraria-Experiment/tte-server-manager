<template>
	<div>
		<StatusTile
			class="grow mt-2 gradient-tile"
			collapsible
			:perm-required="PERMISSIONS.server.world.create"
		>
			<template #header>
				<Icon icon="earth" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Create World</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ mainText }}</p>
			</template>
			<template #content v-if="worldCreationInProgress && !worldCreatePopupOpen">
				<div class="p-5 flex flex-col justify-between h-full">
					<div>
						<div class="flex items-center justify-center mb-4">
							<Spinner class="h-5 w-5 text-teal-4" />
							<p class="font-main font-bold text-teal-5 ml-3">{{ worldCreateStageLabel }}</p>
						</div>
						<p class="font-main text-gray-9 text-sm sm:text-base text-center"><span class="font-bold">Stage:</span> {{ worldCreateStepLabel }}</p>
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
				</div>
				<div class="flex justify-end p-4">
					<FlexButton
						v-if="!serverStore.loading.worldLaunch[selectedInstance]"
						:variant="BTN_VARIANT.PRIMARY"
						@input="createWorld"
						:disabled="!(newWorldData.name && newWorldData.maxPlayers && newWorldData.worldFileLocation)"
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
					<p v-if="lastWorldCreateStatus.progress >= 0" class="font-mono text-gray-8 text-xs mt-3 text-center">Progress: {{ lastWorldCreateStatus.progress }}%</p>
				</div>
			</div>
		</Popup>
	</div>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { TASK_IDS, useStatusStore } from '../../../../stores/statusStore';
import { get, post } from '../../../../util/api';
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
	worldFileLocation: null
});

const defaultLastWorldCreateStatus = () => ({
	requestedBy: null,
	status: "",
	step: "",
	progress: -1,
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
			lastWorldCreateStatus: defaultLastWorldCreateStatus(),
		}
	},
	computed: {
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
		mainText() {
			return this.worldCreationInProgress ? "World creation in progress" : "World creation available";
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		selectedServerData() {
			return this.serverStore.selectedServerData;
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
				const statusResult = await get(`/server/${this.selectedInstance}/world/create/alljobs/status`, PERMISSIONS.server.world.create);

				if (statusResult && statusResult.found !== false) {
					this.lastWorldCreateStatus = statusResult;
				}
			} catch (error) {
				this.statusStore.cancelRepeatingTask(TASK_IDS.CREATE_WORLD_CHECK);
				this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
				this.closeWorldCreatePopup();
				this.$alert.error("Lost connection while tracking world creation status");
				console.error(error);
			}
		},
		startWorldCreatePolling(firstStatus) {
			this.lastWorldCreateStatus = firstStatus;
			this.statusStore.startRepeatingTask(TASK_IDS.CREATE_WORLD_CHECK, () => ["failed", "completed"].includes(this.lastWorldCreateStatus.status), 5000, 60);
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
					password: "",
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
				this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
				if (e.message.includes("Instances not in a valid state")) {
					this.$alert.warning("Could not create world: instance is not running or not responding");
				} else {
					this.$alert.error("Error creating world");
					console.error(e);
				}
			}
		},
		async handleCreationFinished() {
			if (this.lastWorldCreateStatus.status === "completed") {
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
			} else {
				this.$alert.error("World creation failed");
				this.closeWorldCreatePopup();
			}

			this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
			this.lastWorldCreateStatus = defaultLastWorldCreateStatus();
		}
	},
	created() {
		this.statusStore.subscribeToTask(TASK_IDS.CREATE_WORLD_CHECK, this.pollWorldCreateStatus);
		this.statusStore.subscribeToTaskEnd(TASK_IDS.CREATE_WORLD_CHECK, this.handleCreationFinished);
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
