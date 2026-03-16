<template>
	<StatusTile 
		class="grow mt-4 sm:mt-8 gradient-tile"
		:collapsible="!!banData.length"
		:perm-required="PERMISSIONS.server.status.read"
	>
		<template #header>
			<Icon icon="people-group" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">Manage Bans</p>
		</template>
		<template #summary>
			<p class="text-2xl text-teal-4">{{ `${banData.length} ban entries` || 'No ban entries' }}</p>
		</template>
		<template #content>
			<div class="grid banlist-grid p-4 text-white-0 font-mono text-sm overflow-x-auto" v-if="banData.length">
				<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Ban ID</div>
				<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Ban reason</div>
				<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Creator</div>
				<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Ban Start</div>
				<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Ban End</div>
				<div class="text-white-0 p-1 text-md font-bold bg-teal-1">Delete</div>
				<template v-for="(ban, i) in banData">
					<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ ban.identifier }}</div>
					<div :class="[{'bg-gray-4': i%2}, 'p-1 truncate']" :title="ban.reason">{{ ban.reason }}</div>
					<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ ban.banning_user }}</div>
					<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ readableTime(ban.start_date_ticks) }}</div>
					<div :class="[{'bg-gray-4': i%2}, 'p-1']">{{ readableTime(ban.end_date_ticks) }}</div>
					<div :class="[{'bg-gray-4': i%2}, 'p-1 reveal-delete-icon flex justify-center items-center']">
						<div class="sm:opacity-0" >
							<Spinner class="h-5 w-5" color="text-teal-4" v-if="loadingDeleteBan" />
							<Icon icon="xmark" color="text-red-5" size="5" class="cursor-pointer" @click="destroyBan(ban.ticket_number)" v-else />
						</div>	
					</div>
				</template>
			</div>
		</template>
	</StatusTile>
</template>

<script>
import { get, post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Spinner from '../../../common/Spinner.vue';

const DOTNET_UNIX_EPOCH_TICKS = 621355968000000000n;
const DOTNET_TICKS_PER_MILLISECOND = 10000n;
const DOTNET_MAX_TICKS = 3155378976000000000n;


export default {
	mixins: [],
	components: {
		
	},
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
			PERMISSIONS,
			BTN_VARIANT,
			banData: [],
			loadingDeleteBan: false
		}
	},
	computed: {
		
	},
	methods: {
		readableTime(ticksValue) {
			if (ticksValue === null || ticksValue === undefined || ticksValue === '') {
				return 'N/A';
			}

			try {
				const ticks = BigInt(String(ticksValue));

				if (ticks >= DOTNET_MAX_TICKS) {
					return 'Permanent';
				}

				const unixMs = (ticks - DOTNET_UNIX_EPOCH_TICKS) / DOTNET_TICKS_PER_MILLISECOND;
				const unixMsNumber = Number(unixMs);

				if (!Number.isFinite(unixMsNumber)) {
					return String(ticksValue);
				}

				return new Date(unixMsNumber).toLocaleString();
			} catch {
				return String(ticksValue);
			}
		},
		async getBanData() {
			try {
				const bans = await get(`/server/${this.selectedInstance}/bans`, PERMISSIONS.server.player.ban);
				this.banData = bans.result.bans;
			} catch (e) {
				console.error(e);
				this.$alert.error("Failed to fetch ban list");
			}
		},
		async destroyBan(ticketNumber) {
			this.$validatePermissions(PERMISSIONS.server.player.ban);

			if (this.loadingDeleteBan) return;
			this.loadingDeleteBan = true;

			try {
				const result = await post(`/server/${this.selectedInstance}/bans/delete`, PERMISSIONS.server.player.ban, {
					ticketNumber,
					fullDelete: true
				});
				this.$alert.success("Ban removed");
				this.getBanData();
			} catch (e) {
				this.$alert.error("Failed to delete ban");
				console.error(e);
			} finally {
				this.loadingDeleteBan = false;
			}
		}
	},
	async mounted() {
		if (this.$checkPermissions(PERMISSIONS.server.player.ban)) {
			this.getBanData();
		}
	}
}
</script>

<style scoped>
.banlist-grid {
	grid-template-columns: repeat(5, 1fr) auto;
}

.reveal-delete-icon:hover > div {
	@apply opacity-100;
}
</style>
