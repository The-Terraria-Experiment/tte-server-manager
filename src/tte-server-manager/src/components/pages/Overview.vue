<template>
	<div class="w-full flex flex-col gap-4 sm:gap-8">
		<StatusTile 
			:perm-required="PERMISSIONS.system.notice.create"
			:loading="noticeSaving"
			collapsible
			:class="[baseStore.siteEnabled ? 'gradient-tile-green' : 'gradient-tile-red']"
		>
			<template #header>
				<Icon icon="gauge" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">Site Status</p>
			</template>
			<template #summary>
				<p class="text-2xl text-teal-4">{{ baseStore.siteEnabled ? 'ENABLED' : 'DISABLED' }}</p>
			</template>
			<template #content>
				<div v-if="baseStore.siteEnabled" class="flex flex-col p-4 gap-4">
					<LargeTextInput 
						spellcheck="true"
						class="bg-white-0 rounded-lg resize-none text-gray-1 h-20"
						placeholder="Message"
						v-model="announcement"
					/>
					<div class="flex items-center gap-2">
						<Checkbox class="w-5 h-5" v-model="disableSite" />
						<p class="font-main font-bold text-white-0">Disable site</p>
					</div>
					<FlexButton 
						class="" 
						:variant="disableSite ? BTN_VARIANT.DANGER : BTN_VARIANT.PRIMARY"
						@input="setGlobalNotice"
					>
						<p class="py-2 px-12">POST</p>
					</FlexButton>
				</div>
				<div v-else class="p-4">
					<div v-if="baseStore.globalNotice" class="font-main mb-4 bg-gray-3 p-2 rounded-md">
						<p class="font-bold text-white-0">Current message:</p>
						<p class="text-gray-8 italic">{{ baseStore.globalNotice }}</p>
					</div>
					<FlexButton 
						class="" 
						:variant="BTN_VARIANT.PRIMARY"
						@input="clearGlobalNotice"
					>
						<p class="py-2 px-4 md:px-10">CLEAR NOTICE & RE-ENABLE</p>
					</FlexButton>
				</div>
			</template>
		</StatusTile>

		<div class="bg-gray-3 rounded-xl overflow-hidden h-max p-4">
			<h1 class="font-main font-bold text-2xl text-teal-4 mb-8">The Terraria Experiment Server Manager</h1>
			<p class="font-main font-semibold text-white-0 mt-4">Welcome! Parts of this site are still under construction. There may be bugs, bad UI/UX, or broken tools.</p>
			<p class="font-main font-semibold text-white-0 mt-4">
				Please report any issues you find by messaging in <span class="text-yellow-2">#server-general</span> in the Discord server. Make sure to ping <span class="text-yellow-2">@havoc</span>.
			</p>
			<p class="font-main font-semibold text-white-0 mt-4">Thank you!</p>
		</div>

		<div class="bg-gray-3 rounded-xl overflow-hidden h-max p-4">
			<h1 class="font-main font-bold text-2xl text-teal-4 mb-8">Usage Guide</h1>

			<h3 class="font-main font-bold text-xl text-gray-7">Instance Page</h3>
			<p class="font-main font-semibold text-white-0 mt-4">The "instance" is the physical computer that we are using to host the server.</p>
			<p class="font-main font-semibold text-white-0 mt-4">Use the Instance page to turn on/off the computer. Click the "Instance Status" section to reveal the buttons.</p>
			<p class="font-main font-semibold text-white-0 mt-4"><span class="text-red-5">NOTE:</span> Stopping the instance without first stopping the Terraria server will NOT save the world! Any unsaved progress will be LOST!</p>

			<h3 class="font-main font-bold text-xl text-gray-7 mt-8">Server Page</h3>
			<p class="font-main font-semibold text-white-0 mt-4">The "server" is the actual Terraria game server.</p>
			<p class="font-main font-semibold text-white-0 mt-4">Start the server by selecting a world from the "Launch World" section and then clicking "Start Server".</p>

			<h3 class="font-main font-bold text-xl text-gray-7 mt-8">General</h3>
			<p class="font-main font-semibold text-white-0 mt-4">Please be kind to the system. If something is not working, refresh the web page and give it a second. Spamming won't fix things.</p>
			<p class="font-main font-semibold text-white-0 mt-4">If problems persist, feel free to ping @havoc, and I'll get to it as soon as I can.</p>
		</div>
	</div>
</template>

<script>
import screen from '../../mixins/screen';
import { useBaseStore } from '../../stores/baseStore';
import { post } from '../../util/api';
import { BTN_VARIANT } from '../../util/constants';
import { PERMISSIONS } from '../../util/permissionValues';
import Checkbox from '../common/Checkbox.vue';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import LargeTextInput from '../common/LargeTextInput.vue';
import Spinner from '../common/Spinner.vue';
import ValueInput from '../common/ValueInput.vue';


export default {
	mixins: [screen],
	components: {
		Icon,
		FlexButton,
		Spinner,
		ValueInput,
		LargeTextInput,
		Checkbox,
	},
	props: {

	},
	data() {
		return {
			BTN_VARIANT,
			PERMISSIONS,
			baseStore: useBaseStore(),
			announcement: "",
			disableSite: false,
			noticeSaving: false
		}
	},
	methods: {
		async setGlobalNotice() {
			this.$validatePermissions(PERMISSIONS.system.notice.create);

			if (this.noticeSaving) return;
			this.noticeSaving = true;

			try {
				await post("/system/postnotice", PERMISSIONS.system.notice.create, {
					message: this.announcement,
					disableSite: this.disableSite,
				});
				this.$alert.success("Notice saved");
				this.baseStore.loadNotice();
			} catch (e) {
				console.error(e);
				this.$alert.error("Error setting notice");
			} finally {
				this.noticeSaving = false;
			}
		},
		async clearGlobalNotice() {
			this.$validatePermissions(PERMISSIONS.system.notice.clear);

			if (this.noticeSaving) return;
			this.noticeSaving = true;

			try {
				await post("/system/clearnotice", PERMISSIONS.system.notice.clear);
				this.$alert.success("Notice cleared");
				this.baseStore.loadNotice();
			} catch (e) {
				console.error(e);
				this.$alert.error("Error clearing notice");
			} finally {
				this.noticeSaving = false;
			}
		}
	},
	watch: {
		"baseStore.globalNotice": function (value) {
			this.announcement = value;
		}
	}
}
</script>

<style scoped>
@reference "../../theme.css";

.gradient-tile-green {
	@apply bg-linear-to-b from-gray-3 to-green-2 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
	/* transition: background-position 200ms ease; */
}

.gradient-tile-red {
	@apply bg-linear-to-b from-gray-3 to-red-900 from-50%;
	background-size: 100% 200%;
	background-position: 0% 100%;
}

/* .gradient-tile:hover {
	background-position: 0% 100%;
} */
</style>