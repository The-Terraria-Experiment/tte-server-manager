<template>
	<div>
		<StatusTile
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			collapsible
			:perm-required="PERMISSIONS.server.world.create"
		>
			<template #header>
				<Icon icon="earth" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Create World</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">World creation available</p>
			</template>
			<template #content>
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
						<p class="font-main font-bold text-teal-5 ml-3">{{ worldCreateStatusLabel }}</p>
					</div>
					<p class="font-main text-gray-9 text-sm sm:text-base text-center"><span class="font-bold">Stage:</span> {{ worldCreateProgressMessage }}</p>
					<p class="font-mono text-gray-8 text-xs mt-3 text-center">Progress: {{ worldCreateProgress }}%</p>
				</div>
				<p v-if="worldCreateJobId" class="font-mono text-gray-6 text-xs mt-1 text-center">Job: {{ worldCreateJobId }}</p>
			</div>
		</Popup>
	</div>
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { get, post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Dropdown from "../../../common/Dropdown.vue";
import Popup from "../../../common/Popup.vue";


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
			newWorldData: {
				size: 1,
				difficulty: 3,
				evil: 1,
				name: "",
				seed: "fortheworthy",
				maxPlayers: 16,
				port: 7777,
				worldFileLocation: null
			},
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
			worldCreateJobId: null,
			worldCreateProgress: 0,
			worldCreateProgressMessage: "Preparing world creation",
			worldCreateStatus: "idle",
			worldCreatePollHandle: null,
		}
	},
	computed: {
		worldFileLocationOptions() {
			const fileRoots = this.serverStore.instanceFileRoots[this.selectedInstance] || {};
			const worldPathNicknames = this.serverStore.instanceWorldPaths[this.selectedInstance] ?? [];
			const worldRoots = worldPathNicknames
				.filter(pname => this.$checkResourceAccess(`filepath::${this.selectedInstance}::${pname}`))
				.map(nickname => fileRoots[nickname])
				.filter((path) => !!path);
			return worldRoots.map(r => ({ id: r, text: r }));
		},
		worldCreateStatusLabel() {
			if (this.worldCreateStatus === "completed") return "World Created";
			if (this.worldCreateStatus === "failed") return "World Creation Failed";
			if (this.worldCreateStatus === "queued") return "Queued";
			return "Working";
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		selectedServerData() {
			return this.serverStore.selectedServerData;
		}
	},
	methods: {
		openWorldCreatePopup(jobId, message = "World creation started") {
			this.worldCreatePopupOpen = true;
			this.worldCreateJobId = jobId;
			this.worldCreateProgress = 0;
			this.worldCreateProgressMessage = message;
			this.worldCreateStatus = "queued";
		},
		closeWorldCreatePopup() {
			this.worldCreatePopupOpen = false;
			this.worldCreatePollHandle = null;
			this.worldCreateJobId = null;
		},
		stopWorldCreatePolling() {
			if (this.worldCreatePollHandle) {
				clearInterval(this.worldCreatePollHandle);
				this.worldCreatePollHandle = null;
			}
		},
		async pollWorldCreateStatus() {
			if (!this.worldCreateJobId || !this.selectedInstance) return;

			try {
				const data = await get(
					`/server/${this.selectedInstance}/world/create/${this.worldCreateJobId}/status`,
					PERMISSIONS.server.world.create
				);

				this.worldCreateStatus = data.status || "running";
				this.worldCreateProgress = Number(data.progress || 0);
				this.worldCreateProgressMessage = data.message || "Working";

				if (data.isDone || ["completed", "failed"].includes(data.status)) {
					this.stopWorldCreatePolling();
					this.serverStore.loading.worldLaunch[this.selectedInstance] = false;

					if (data.status === "completed") {
						this.worldCreateProgress = 100;
						this.$alert.success("World created and saved successfully");
						this.worldCreateProgressMessage = "Waiting for server launch";
						setTimeout(() => {
							setTimeout(() => this.$emit("refresh"), 500);
							setTimeout(() => this.closeWorldCreatePopup(), 1200);
						}, 7000);
					} else {
						this.$alert.error(data.error || data.message || "World creation failed");
						this.closeWorldCreatePopup();
					}
				}
			} catch (error) {
				this.stopWorldCreatePolling();
				this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
				this.closeWorldCreatePopup();
				this.$alert.error("Lost connection while tracking world creation status");
				console.error(error);
			}
		},
		startWorldCreatePolling() {
			this.stopWorldCreatePolling();
			this.pollWorldCreateStatus();
			this.worldCreatePollHandle = setInterval(() => {
				this.pollWorldCreateStatus();
			}, 3000);
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

				if (!queued?.jobId) {
					throw new Error("World create request did not return a job ID");
				}

				this.openWorldCreatePopup(queued.jobId, queued.progressMessage || queued.message || "World creation started");
				this.startWorldCreatePolling();
			} catch (e) {
				this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
				if (e.message.includes("Instances not in a valid state")) {
					this.$alert.warning("Could not create world: instance is not running or not responding");
				} else {
					this.$alert.error("Error creating world");
					console.error(e);
				}
			}
		}
	},
	mounted() {
		
	},
	beforeUnmount() {
		this.stopWorldCreatePolling();
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
