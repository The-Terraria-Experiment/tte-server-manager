<template>
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
			<p class="text-2xl text-teal-4">{{ chosenCreateWorldText }}</p>
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
</template>

<script>
import { useServerStore } from '../../../../stores/serverStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Dropdown from "../../../common/Dropdown.vue";


export default {
	mixins: [],
	components: {
		Dropdown,
	},
	props: {
		selectedInstance: {
			type: [String, null],
			required: true
		},
		selectedServerData: {
			type: Object,
			required: true,
		}
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
				seed: "for the worthy",
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
			createWorldTexts: [
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"A new adventure awaits...",
				"This is the one",
				"Worlds without number",
				"Simulator? I hardly know 'er",
			],
			chosenCreateWorldText: null
		}
	},
	computed: {
		worldFileLocationOptions() {
			const worldRoots = Object.values(this.serverStore.instanceWorldPaths[this.selectedInstance] ?? []);
			return worldRoots.map(r => ({ id: r, text: r }));
		}
	},
	methods: {
		async createWorld() {
			this.$validatePermissions(PERMISSIONS.server.world.create);


			if (this.serverStore.loading.worldLaunch[this.selectedInstance]) return;

			if (
				this.newWorldData.size < 1 || this.newWorldData.size > 3 || 
				this.newWorldData.difficulty < 1 || this.newWorldData.difficulty > 4 ||
				this.newWorldData.evil < 1 || this.newWorldData.evil > 3 ||
				!this.newWorldData.name || !/^[a-zA-Z0-9_\s]+$/.test(this.newWorldData.name) ||
				!this.newWorldData.maxPlayers ||
				!this.newWorldData.worldFileLocation
			) {
				this.$alert.error("Invalid world data");
				return;
			}

			this.serverStore.loading.worldLaunch[this.selectedInstance] = true;

			try {
				await post(`/server/${this.selectedInstance}/world/create`, PERMISSIONS.server.world.create, {
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
				this.$alert.success("Creating world");
				// this.pollInstanceState();
			} catch (e) {
				if (e.message.includes("Instances not in a valid state")) {
					this.$alert.warning("Could not create world: instance is not running or not responding");
				} else {
					this.$alert.error("Error creating world");
					console.error(e);
				}
			} finally {
				this.serverStore.loading.worldLaunch[this.selectedInstance] = false;
			}
		},
		getRandomCreateText() {
			const index = Math.floor(Math.random() * this.createWorldTexts.length);
			return this.createWorldTexts[index];
		}
	},
	mounted() {
		this.chosenCreateWorldText = this.getRandomCreateText();
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
