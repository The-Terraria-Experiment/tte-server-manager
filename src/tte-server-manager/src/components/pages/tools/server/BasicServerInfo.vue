<template>
	<div class="flex flex-col sm:grid sm:grid-cols-4">
		<StatusTile 
			:class="['grow mt-4 sm:mt-8 sm:mx-1 gradient-tile', selectedServerData.state ? 'gradient-tile-green' : 'gradient-tile-red']"
			:collapsible="selectedServerData.state"
			:perm-required="PERMISSIONS.server.status.read"
			:loading="statusLoading"
		>
			<template #header>
				<Icon icon="power" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Server Status</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ selectedServerData.state ? 'RUNNING' : 'OFFLINE' }}</p>
			</template>
			<template #content>
				<div v-if="selectedServerData.state">
					<FlexButton 
						v-if="$checkPermissions(PERMISSIONS.server.status.stop) && showStopButton"
						class="mx-4 mb-4" 
						:variant="BTN_VARIANT.DANGER"
						@input="openConfirmStopPopup"
					>
						<p class="py-2 px-12">STOP</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:collapsible="!!selectedServerData.playercount"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="people-group" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Players</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ playerCountText }}</p>
			</template>
			<template #content>
				<div v-if="selectedServerData.players?.length" class="font-main font-semibold px-2 pb-2 text-teal-6 flex w-full flex-wrap">
					<template v-for="player in selectedServerData.players">
						<div class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1 hover:bg-gray-6 transition-colors duration-100" @click="openManagePlayerPopup(player)">{{ player.nickname }}</div>
					</template>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			collapsible
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="circle-info" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Server Info</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">7 entries</p>
			</template>
			<template #content>
				<div class="grid info-grid font-mono m-4 bg-gray-4 rounded-lg text-white-0">
					<div class="px-2 py-1">Active World</div>
					<div class="px-2 py-1">{{ selectedServerData.world ?? "Unknown" }}</div>

					<div class="bg-gray-5 px-2 py-1">Terraria Version</div>
					<div class="bg-gray-5 px-2 py-1">{{ selectedServerData.serverversion ?? "Unknown" }}</div>

					<div class="px-2 py-1">TShock Version</div>
					<div class="px-2 py-1">{{ selectedServerData.tshockversion ?? "Unknown" }}</div>

					<div class="bg-gray-5 px-2 py-1">Port</div>
					<div class="bg-gray-5 px-2 py-1">{{ selectedServerData.port ?? "Unknown" }}</div>

					<div class="px-2 py-1">Max Players</div>
					<div class="px-2 py-1">{{ selectedServerData.maxplayers ?? "Unknown" }}</div>

					<div class="bg-gray-5 px-2 py-1">Uptime</div>
					<div class="bg-gray-5 px-2 py-1">{{ selectedServerData.uptime ?? "Unknown" }}</div>

					<div class="px-2 py-1">Password</div>
					<div class="px-2 py-1">{{ selectedServerData.serverpassword ?? "Unknown" }}</div>
				</div>
			</template>
		</StatusTile>

		<StatusTile 
			class="grow mt-4 sm:mt-8 sm:mx-1 gradient-tile"
			:collapsible="!!ruleEntryCount"
			:perm-required="PERMISSIONS.server.status.read"
		>
			<template #header>
				<Icon icon="scroll" color="text-gray-6" size="5" />
				<p class="text-gray-6 ml-2 text-lg">Rules</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ ruleEntryCount }} entries</p>
			</template>
			<template #content>
				<div v-if="ruleEntryCount" class="grid info-grid font-mono m-4 bg-gray-4 rounded-lg text-white-0">
					<template v-for="(value, rule, i) in selectedServerData.rules">
						<div :class="['px-2 py-1', {'bg-gray-5': i%2}]">{{ rule }}</div>
						<div :class="['px-2 py-1', {'bg-gray-5': i%2}]">{{ value }}</div>
					</template>
				</div>
			</template>
		</StatusTile>
	</div>

	<Popup
		body-class="h-1/4 w-11/12 sm:w-1/2 lg:w-1/4"
		header-text="CONFIRM"
		:open="confirmStopPopupOpen"
		@x-clicked="confirmStopPopupOpen = false"
		:buttons="[
			{ variant: BTN_VARIANT.PRIMARY, text: 'CANCEL', onClick: () => { confirmStopPopupOpen = false } },
			{ variant: BTN_VARIANT.DANGER, text: 'STOP SERVER', onClick: stopServer },
		]"
	>
		<div class="p-4 h-full w-full flex text-center justify-center items-center font-main font-bold text-red-5">
			Are you sure you want to stop this server? There are currently {{ this.selectedServerData.playercount }} players online.
		</div>
	</Popup>

	<Popup 
		body-class="h-3/4 w-11/12 sm:w-3/4 lg:w-1/4"
		:open="managePlayerPopupOpen"
		header-text="MANAGE PLAYER"
		@x-clicked="closeManagePlayerPopup"
	>
		<div v-if="managePlayerStatus.playerLoading" class="p-4 h-full w-full">
			<div class="flex items-center justify-center">
				<Spinner class="h-6 w-6 text-teal-4 mr-2" />
				<p class="font-main font-bold text-teal-4">Loading player data...</p>
			</div>
		</div>
		<div class="px-2 py-3 h-full w-full flex flex-col gap-4" v-else>
			<div class="font-main font-bold p-2 bg-gray-4 rounded-xl pl-3">
				<span class="italic text-gray-7 mr-2">Player:</span> 
				<span class="text-teal-5">{{ manageOptions.selectedPlayer.nickname }}</span>
			</div>
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
	</Popup>

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
import { get, post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { plural } from '../../../../util/format';
import { PERMISSIONS } from '../../../../util/permissionValues';
import { getDateOffset } from '../../../../util/timeutils';
import DateTimePickerPopup from '../../../common/DateTimePickerPopup.vue';
import FlexButton from '../../../common/FlexButton.vue';
import Icon from '../../../common/Icon.vue';
import Popup from "../../../common/Popup.vue";
import Spinner from '../../../common/Spinner.vue';

export default {
	mixins: [],
	components: {
		Popup,
		DateTimePickerPopup,
	},
	emits: ['autoRefreshAt'],
	props: {
		selectedServerData: {
			type: Object,
			required: true
		},
		selectedInstance: {
			type: [String, null],
			required: true
		},
	},
	data() {
		return {
			BTN_VARIANT,
			PERMISSIONS,
			statusLoading: false,
			confirmStopPopupOpen: false,
			managePlayerPopupOpen: false,
			banStartPickerOpen: false,
			banEndPickerOpen: false,
			showStopButton: true,
			manageOptions: {
				banStart: null,
				banEnd: null,
				banReason: "",
				kickReason: "",
				killedBy: "",
				selectedPlayer: null,
				selectedPlayerFullData: null,
			},
			managePlayerStatus: {
				playerLoading: false,
				banLoading: false,
				kickLoading: false,
				killLoading: false,
				muteLoading: false
			}
		}
	},
	computed: {
		playerCountText() {
			if (typeof this.selectedServerData.playercount === 'number') {
				return `${this.selectedServerData.playercount} player${plural(this.selectedServerData.playercount || 0)} online`
			}
			return 'Unknown';
		},
		ruleEntryCount() {
			return Object.keys(this.selectedServerData.rules || {}).length;
		}
	},
	methods: {
		openConfirmStopPopup() {
			if (this.selectedServerData.playercount && this.selectedServerData.playercount > 0) {
				this.confirmStopPopupOpen = true;
			} else {
				this.stopServer();
			}
		},

		async stopServer() {
			this.confirmStopPopupOpen = false;
			this.$validatePermissions(PERMISSIONS.server.status.stop);

			if (this.statusLoading) return;
			this.statusLoading = true;

			try {
				const response = await post(`/server/${this.selectedInstance}/stop`, PERMISSIONS.server.status.stop);
				const refreshAt = getDateOffset(5000).valueOf();
				this.showStopButton = false;
				this.$emit("autoRefreshAt", refreshAt);
				setTimeout(() => {
					this.$emit("autoRefreshAt", null);
					this.showStopButton = true;
				}, 6000);
				this.$alert.success("Server stopping");
			} catch (e) {
				this.$alert.error("Error stopping server");
				console.error(e);
			} finally {
				this.statusLoading = false;
			}
		},

		async openManagePlayerPopup(player) {
			if (!this.$checkPermissions([PERMISSIONS.server.player.ban, PERMISSIONS.server.player.kick, PERMISSIONS.server.player.kill, PERMISSIONS.server.player.mute], false)) {
				return;
			}

			this.manageOptions.selectedPlayer = player;
			this.managePlayerPopupOpen = true;

			try {
				await this.readPlayer();
			} catch (e) {
				this.manageOptions.selectedPlayer = null;
				console.error(e);
				this.$alert.error("Failed to read player data");
				this.managePlayerPopupOpen = false;
			}
		},

		closeManagePlayerPopup() {
			this.managePlayerPopupOpen = false;
			this.manageOptions.banEnd = null;
			this.manageOptions.banStart = null;
		},

		async readPlayer() {
			this.$validatePermissions(PERMISSIONS.server.player.read);

			if (this.managePlayerStatus.playerLoading) return;
			this.managePlayerStatus.playerLoading = true;

			this.manageOptions.selectedPlayerFullData = await get(`/server/${this.selectedInstance}/players/${this.manageOptions.selectedPlayer.nickname}`, PERMISSIONS.server.player.read);
		},

		async banPlayer() {
			this.$validatePermissions(PERMISSIONS.server.player.ban);

			if (this.managePlayerStatus.banLoading) return;
			this.managePlayerStatus.banLoading = true;

			try {
				const response = await post(`/server/${this.selectedInstance}/players/ban`, PERMISSIONS.server.player.ban, {
					playerID: this.manageOptions.selectedPlayer.nickname,
					reason: this.manageOptions.banReason || undefined,
					banStart: this.manageOptions.banStart || undefined,
					banEnd: this.manageOptions.banEnd || undefined,
				});

				this.$alert.success("Player banned");
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
					playerID: this.manageOptions.selectedPlayer.nickname,
					reason: this.manageOptions.banReason || undefined,
				});

				this.$alert.success("Player kicked");
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
					playerID: this.manageOptions.selectedPlayer.nickname,
					reason: this.manageOptions.banReason || undefined,
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
					playerID: this.manageOptions.selectedPlayer.nickname,
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
.info-grid {
	grid-template-columns: 1fr auto;
}
</style>
