<template>
	<div class="h-full w-full flex flex-col gap-4">
		<div 
			class="p-2 bg-gray-4 rounded-xl" 
			v-if="$checkPermissions(PERMISSIONS.server.player.ban)"
		>
			<div class="flex items-center mb-2">
				<Icon icon="gavel" color="text-gray-6" size="5"/>
				<p class="font-main font-bold text-gray-6 ml-2">BAN PLAYER</p>
			</div>
			<div class="py-2 px-3 bg-gray-3 rounded-md font-main font-bold text-white-0 flex items-center">
				<p>Ban Start:</p>
				<div 
					@click="banStartPickerOpen = true"
					class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
				>
					<p class="mr-2">{{ manageOptions.banStart || 'now' }}</p> 
					<Icon icon="edit" color="text-white-1" size="5" />
				</div>
			</div>
			<div class="py-2 px-3 bg-gray-3 rounded-md font-main font-bold text-white-0 my-2 flex items-center">Ban End:
				<div 
					@click="banEndPickerOpen = true"
					class="bg-blue-0 hover:bg-blue-1 transition-colors duration-100 rounded px-2 py-1 ml-2 text-white-1 cursor-pointer flex items-center"
				>
					<p class="mr-2">{{ manageOptions.banEnd || 'never' }}</p> 
					<Icon icon="edit" color="text-white-1" size="5" />
				</div>
			</div>
			<label class="py-2 px-3 bg-gray-3 rounded-md font-main font-bold text-white-0 my-2 flex items-center select-none">
				<Checkbox v-model="manageOptions.includeIpBan" class="h-5 w-5 mr-2" />
				IP Ban
			</label>
			<ValueInput class="w-full" placeholder="Ban Reason (optional)" v-model="manageOptions.banReason" />
			<div class="flex justify-end mt-6">
				<Spinner v-if="managePlayerStatus.banLoading" class="h-6 w-6 text-teal-4 mr-4 mb-2" />
				<FlexButton :variant="BTN_VARIANT.DANGER" @input="banPlayer" v-else>
					<p class="font-main font-bold py-2 px-4 md:px-10">DELIVER BAN</p>
				</FlexButton>
			</div>
		</div>

		<div 
			class="p-2 bg-gray-4 rounded-xl"
			v-if="$checkPermissions(PERMISSIONS.server.player.kick)"
		>
			<div class="flex items-center mb-2">
				<Icon icon="user-slash" color="text-gray-6" size="5"/>
				<p class="font-main font-bold text-gray-6 ml-2">KICK PLAYER</p>
			</div>
			<ValueInput class="w-full" placeholder="Kick Reason (optional)" v-model="manageOptions.kickReason" />
			<div class="flex justify-end mt-6">
				<Spinner v-if="managePlayerStatus.kickLoading" class="h-6 w-6 text-teal-4 mr-4 mb-2" />
				<FlexButton :variant="BTN_VARIANT.DANGER" @input="kickPlayer" v-else>
					<p class="font-main font-bold py-2 px-4 md:px-10">PERFORM KICK</p>
				</FlexButton>
			</div>
		</div>

		<div 
			class="p-2 bg-gray-4 rounded-xl"
			v-if="$checkPermissions(PERMISSIONS.server.player.kill)"
		>
			<div class="flex items-center mb-2">
				<Icon icon="skull" color="text-gray-6" size="5"/>
				<p class="font-main font-bold text-gray-6 ml-2">KILL PLAYER</p>
			</div>
			<ValueInput class="w-full" placeholder="Killed By (optional)" v-model="manageOptions.killedBy" />
			<div class="flex justify-end mt-6">
				<Spinner v-if="managePlayerStatus.killLoading" class="h-6 w-6 text-teal-4 mr-4 mb-2" />
				<FlexButton :variant="BTN_VARIANT.DANGER" @input="killPlayer" v-else>
					<p class="font-main font-bold py-2 px-4 md:px-10">EXECUTE</p>
				</FlexButton>
			</div>
		</div>

		<div 
			class="p-2 bg-gray-4 rounded-xl"
			v-if="$checkPermissions(PERMISSIONS.server.player.mute)"
		>
			<div class="flex items-center mb-2">
				<Icon icon="comment-slash" color="text-gray-6" size="5"/>
				<p class="font-main font-bold text-gray-6 ml-2">MUTE PLAYER</p>
			</div>
			<div class="flex justify-end mt-6">
				<Spinner v-if="managePlayerStatus.banLoading" class="h-6 w-6 text-teal-4 mr-4 mb-2" />
				<FlexButton :variant="BTN_VARIANT.DANGER" @input="mutePlayer" v-else>
					<p class="font-main font-bold py-2 px-4 md:px-10">SILENCE FROM YOU</p>
				</FlexButton>
			</div>
		</div>

		<div class="text-gray-3">?</div>
	</div>

	<DateTimePickerPopup 
		:open="banStartPickerOpen" 
		@close="banStartPickerOpen = false"
		@cancel="banStartPickerOpen = false; manageOptions.banStart = null;"
		v-model="manageOptions.banStart"
	/>

	<DateTimePickerPopup 
		:open="banEndPickerOpen" 
		@close="banEndPickerOpen = false"
		@cancel="banEndPickerOpen = false; manageOptions.banEnd = null;"
		v-model="manageOptions.banEnd"
	/>
</template>

<script>
import { useServerStore } from '../../../../../../stores/serverStore';
import { post } from '../../../../../../util/api';
import { BTN_VARIANT } from '../../../../../../util/constants';
import { PERMISSIONS } from '../../../../../../util/permissionValues';
import Checkbox from '../../../../../common/Checkbox.vue';
import DateTimePickerPopup from '../../../../../common/DateTimePickerPopup.vue';


export default {
	mixins: [],
	components: {
		DateTimePickerPopup,
		Checkbox,
	},
	props: {
		selectedPlayer: {
			type: Object,
			required: true,
		}
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			managePlayerPopupOpen: false,
			banStartPickerOpen: false,
			banEndPickerOpen: false,
			manageOptions: {
				banStart: null,
				banEnd: null,
				includeIpBan: true,
				banReason: "",
				kickReason: "",
				killedBy: "",
				selectedPlayerFullData: null,
			},
			managePlayerStatus: {
				playerLoading: false,
				banLoading: false,
				kickLoading: false,
				killLoading: false,
				muteLoading: false
			},
			playerDataCache: {},
		}
	},
	computed: {
		selectedServerData() {
			return this.serverStore.selectedServerData;
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
	},
	methods: {
		// async readPlayer() {
		// 	this.$validatePermissions(PERMISSIONS.server.player.read);

		// 	if (this.managePlayerStatus.playerLoading) return;
		// 	this.managePlayerStatus.playerLoading = true;

		// 	const playerName = this.manageOptions.selectedPlayer.nickname;

		// 	if (this.playerDataCache[playerName]) {
		// 		return this.playerDataCache[playerName];
		// 	}

		// 	const result = await get(`/server/${this.selectedInstance}/players/${playerName}`, PERMISSIONS.server.player.read);
		// 	this.manageOptions.selectedPlayerFullData = result;
		// 	this.playerDataCache[playerName] = result;
		// },

		async banPlayer() {
			this.$validatePermissions(PERMISSIONS.server.player.ban);

			if (this.managePlayerStatus.banLoading) return;
			this.managePlayerStatus.banLoading = true;

			try {
				const response = await post(`/server/${this.selectedInstance}/players/ban`, PERMISSIONS.server.player.ban, {
					playerID: this.selectedPlayer.nickname,
					reason: this.manageOptions.banReason || undefined,
					banStart: this.manageOptions.banStart || undefined,
					banEnd: this.manageOptions.banEnd || undefined,
					includeIpBan: this.manageOptions.includeIpBan,
				});

				this.$alert.success("Player banned");
				this.$emit("refresh");
			} catch (e) {
				console.error(e);
				this.$alert.error("Failed to ban player");
			} finally {
				this.managePlayerStatus.banLoading = false;
			}
		},

		async kickPlayer() {
			this.$validatePermissions(PERMISSIONS.server.player.kick);

			if (this.managePlayerStatus.kickLoading) return;
			this.managePlayerStatus.kickLoading = true;

			try {
				const response = await post(`/server/${this.selectedInstance}/players/kick`, PERMISSIONS.server.player.kick, {
					playerID: this.selectedPlayer.nickname,
					reason: this.manageOptions.kickReason || undefined,
				});

				this.$alert.success("Player kicked");
				this.$emit("refresh");
			} catch (e) {
				console.error(e);
				this.$alert.error("Failed to kick player");
			} finally {
				this.managePlayerStatus.kickLoading = false;
			}
		},

		async killPlayer() {
			this.$validatePermissions(PERMISSIONS.server.player.kill);

			if (this.managePlayerStatus.killLoading) return;
			this.managePlayerStatus.killLoading = true;

			try {
				const response = await post(`/server/${this.selectedInstance}/players/kill`, PERMISSIONS.server.player.kill, {
					playerID: this.selectedPlayer.nickname,
					reason: this.manageOptions.killedBy || undefined,
				});

				this.$alert.success("Player killed");
			} catch (e) {
				console.error(e);
				this.$alert.error("Failed to kill player");
			} finally {
				this.managePlayerStatus.killLoading = false;
			}
		},

		async mutePlayer() {
			this.$validatePermissions(PERMISSIONS.server.player.mute);

			if (this.managePlayerStatus.muteLoading) return;
			this.managePlayerStatus.muteLoading = true;

			try {
				const response = await post(`/server/${this.selectedInstance}/players/mute`, PERMISSIONS.server.player.mute, {
					playerID: this.selectedPlayer.nickname,
				});

				this.$alert.success("Player muted");
			} catch (e) {
				console.error(e);
				this.$alert.error("Failed to mute player");
			} finally {
				this.managePlayerStatus.muteLoading = false;
			}
		}
	},
}
</script>

<style scoped>

</style>
