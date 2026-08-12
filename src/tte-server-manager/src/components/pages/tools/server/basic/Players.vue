<template>
	<StatusTile 
		class="grow gradient-tile"
		:collapsible="!!selectedServerData.playercount"
		:contentLoaded="selectedServerData.playercount !== undefined"
		:perm-required="PERMISSIONS.server.status.read"
		:floatingExpand="!isMobile"
	>
		<template #header>
			<Icon icon="people-group" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Players</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">{{ playerCountText }}</p>
		</template>
		<template #content>
			<div v-if="selectedServerData.players?.length" class="font-main font-semibold px-2 pb-2 text-teal-6 flex w-full flex-wrap max-h-100 overflow-y-auto">
				<template v-for="player in selectedServerData.players">
					<div 
						class="px-4 py-2 bg-gray-5 text-teal-6 rounded-lg cursor-pointer mx-1 my-1 hover:bg-gray-6 transition-colors duration-100" 
						@click="openManagePlayerPopup(player)"
					>
						{{ player.nickname }}
					</div>
				</template>
			</div>
		</template>
	</StatusTile>

	<!--
		Wider than the other popups because the inventory grid reproduces the in-game layout: ten
		columns of main inventory plus the equipment/vanity/dye columns don't fit in 3/4 width.
	-->
	<Popup
		:body-class="['h-3/4 w-11/12 sm:w-11/12', $checkPermissions(PERMISSIONS.server.player.inventory.read) ? 'lg:w-11/12' : 'lg:w-1/4']"
		:open="managePlayerPopupOpen"
		header-text="MANAGE PLAYER"
		@x-clicked="closeManagePlayerPopup"
	>
		<div class="p-2">
			<div class="font-main font-bold p-2 bg-gray-4 rounded-xl pl-3 mb-4">
				<span class="italic text-gray-7 mr-2">Player:</span>
				<span class="text-teal-5">{{ selectedPlayer.nickname }}</span>
			</div>
			<div class="flex flex-col sm:flex-row gap-4">
				<!-- Management actions keep a fixed column; the inventory takes the rest and scrolls. -->
				<div :class="[$checkPermissions(PERMISSIONS.server.player.inventory.read) ? 'sm:w-80 shrink-0' : 'w-full']">
					<ManagePlayer :selected-player="selectedPlayer" @refresh="refreshRoster" />
				</div>
				<div v-if="$checkPermissions(PERMISSIONS.server.player.inventory.read)" class="grow min-w-0 overflow-y-auto">
					<PlayerInventory :selected-player="selectedPlayer" />
				</div>
			</div>
		</div>
	</Popup>
</template>

<script>
import { useServerStore } from '../../../../../stores/serverStore';
import { BTN_VARIANT } from '../../../../../util/constants';
import { PERMISSIONS } from '../../../../../util/permissionValues';
import Popup from '../../../../common/Popup.vue';
import { plural } from '../../../../../util/format';
import ManagePlayer from "./players/ManagePlayer.vue";
import PlayerInventory from "./players/PlayerInventory.vue";

export default {
	mixins: [],
	components: {
		Popup,
		ManagePlayer,
		PlayerInventory,
	},
	props: {
		
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			serverStore: useServerStore(),
			managePlayerPopupOpen: false,
			selectedPlayer: null,
		}
	},
	computed: {
		selectedServerData() {
			return this.serverStore.selectedServerData;
		},
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		playerCountText() {
			if (typeof this.selectedServerData.playercount === 'number') {
				return `${this.selectedServerData.playercount} player${plural(this.selectedServerData.playercount || 0)} online`
			}
			return 'Unknown';
		},
	},
	methods: {
		async openManagePlayerPopup(player) {
			if (!this.$checkPermissions([
				PERMISSIONS.server.player.ban, PERMISSIONS.server.player.kick, PERMISSIONS.server.player.kill, PERMISSIONS.server.player.mute,
				PERMISSIONS.server.player.inventory.read
			], false)) {
				return;
			}

			this.selectedPlayer = player;
			this.managePlayerPopupOpen = true;
		},
		closeManagePlayerPopup() {
			this.selectedPlayer = null;
			this.managePlayerPopupOpen = false;
		},
		/**
		 * ManagePlayer emits this after a kick or a ban. It had no listener, so a kicked player stayed
		 * in this tile until something else happened to refetch the status — the action that changes
		 * the roster was the one action that didn't update it.
		 *
		 * This is the same refetch a `player.leave` socket event triggers, so on a socket-enabled
		 * client the two race and the loading guard drops one of them; that's the intended cost of
		 * keeping the local path working when the socket is unavailable.
		 */
		async refreshRoster() {
			try {
				await this.serverStore.fetchServerStatus(this.selectedInstance);
			} catch {
				// The store already logs it, and the kick/ban itself succeeded — a second, contradictory
				// alert about the refresh would be worse than a stale count.
			}
		},
		plural,
	},
}
</script>

<style scoped>

</style>
