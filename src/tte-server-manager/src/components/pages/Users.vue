<template>
	<div>
		<StatusTile>
			<template #header>
				<Icon icon="key" color="text-gray-6" size="4" />
				<p class="text-gray-6 ml-2 text-lg">User Permissions</p>
			</template>
			<template #summary>
				<FlexButton 
					class="bg-gray-4 hover:bg-gray-2 w-max pl-4 pr-6 py-2" 
					@input="fetchUserPermissions"
					:disabled="loading.permissions"
				>
					<div class="flex items-center">
						<Spinner v-if="loading.permissions" class="h-4 w-4 text-teal-3" thickness="4" />
						<Icon v-else icon="arrow-rotate-right" color="text-teal-3" size="4" />
						<p class="text-teal-3 ml-2">REFRESH</p>
					</div>
				</FlexButton>
			</template>
			<template #content>
				<div class="grid overflow-x-auto pt-40 relative pr-20 text-sm" :style="userPermsCols" @scroll="updateUserTableScroll">
					<div :class="['sticky left-0 bg-gray-3 px-4 py-2 flex items-center z-10', stickyShadow]">
						<div class="bg-gray-3 h-60 absolute w-full left-0 bottom-5 z-10 facadeStickyShadow"></div>
						<p class="font-main font-bold text-cream relative z-20">USER</p>
					</div>
					<template v-for="permValue in allPerms">
						<div class="px-2 flex items-center w-20 relative">
							<p class="font-mono text-cream origin-left -rotate-45 absolute left-8 bottom-0">{{ permValue }}</p>
						</div>
					</template>

					<template v-for="(user, idx) in Object.values(permissionsData)">
						<div :class="['sticky left-0 p-2 flex items-center z-10 overflow-x-auto', stickyShadow, idx%2 ? 'bg-gray-3' : 'bg-gray-4']">
							<p class="font-mono font-semibold text-cream">{{ user.username }}</p>
						</div>
						<template v-for="permValue in allPerms">
							<div :class="['px-2 flex items-center w-20 relative justify-center border-r-2 border-gray-2', idx%2 ? 'bg-gray-3' : 'bg-gray-4']">
								<Checkbox 
									class="h-5 w-5"
									:disabled="!userStore.hasPermission(PERMISSIONS.users.permissions.write)"
									:value="updatedPermissions?.[user.userID] ? updatedPermissions[user.userID].has(permValue) : user.permissions.has(permValue)"
									@input="setUserPerm(user.userID, permValue, $event)"
								/>
							</div>
						</template>
					</template>
				</div>

				<div 
					class="w-full flex justify-end p-4"
					v-show="dirtyPermissions"
				>
					<div v-if="!loading.save" class="flex">
						<FlexButton :variant="BTN_VARIANT.DANGER" class="ml-4" @click="discardPermChanges">
							<p class="font-main font-bold py-2 px-8 md:px-12 text-sm">DISCARD</p>
						</FlexButton>
						<FlexButton :variant="BTN_VARIANT.PRIMARY" class="ml-4" @click="savePermChanges">
							<p class="font-main font-bold py-2 px-8 md:px-12 text-sm">SAVE</p>
						</FlexButton>
					</div>
					<div v-else class="flex items-center pr-4">
						<Spinner class="h-4 w-4 text-teal-3" thickness="4" />
						<p class="font-main font-bold text-teal-3 ml-2">Saving...</p>
					</div>
				</div>
			</template>
		</StatusTile>
	</div>
</template>

<script>
import { useUserStore } from '../../stores/userStore';
import { get, post } from '../../util/api';
import { PERMISSIONS } from '../../util/permissionValues';
import Checkbox from '../common/Checkbox.vue';
import FlexButton from '../common/FlexButton.vue';
import Icon from '../common/Icon.vue';
import Spinner from '../common/Spinner.vue';
import StatusTile from '../common/StatusTile.vue';
import validatePermissions from "../../util/validatePermissions";
import { BTN_VARIANT } from '../../util/constants';

export default {
	components: {
		StatusTile,
		Icon,
		FlexButton,
		Spinner,
		Checkbox,
	},
	props: {

	},
	data() {
		return {
			loading: {
				permissions: false,
				save: false,
			},
			PERMISSIONS,
			BTN_VARIANT,
			permissionsData: [],
			userTableScroll: 0,
			updatedPermissions: {},
			dirtyPermissions: false,
		}
	},
	computed: {
		userStore() {
			return useUserStore();
		},
		allPerms() {
			const permList = [];

			const extract = (perms) => {
				Object.entries(perms).forEach(([key, value]) => {
					if (typeof value === 'string') {
						permList.push(value);
					} else {
						extract(value);
					}
				});
			}

			extract(PERMISSIONS);
			return permList;
		},
		userPermsCols() {
			return `grid-template-columns: 25vw repeat(${this.allPerms.length}, auto)`;
		},
		stickyShadow() {
			if (this.userTableScroll >= 2) {
				return 'tableStickyShadow';
			}
		}
	},
	methods: {
		async fetchUserPermissions() {
			if (this.loading.permissions) return;
			this.loading.permissions = true;

			await this.userStore.ensureUserFetched();
			const allPermissions = await get("/users/permissions", PERMISSIONS.users.permissions.read);

			this.permissionsData =
				Object.fromEntries((allPermissions.entries || []).map(udata => [udata.userID, { ...udata, permissions: new Set(udata.permissions) }]));

			this.loading.permissions = false;
		},
		updateUserTableScroll(event) {
			this.userTableScroll = event.currentTarget.scrollLeft;
		},
		setUserPerm(userID, permission, value) {
			validatePermissions(PERMISSIONS.users.permissions.write);

			let permAtPath = PERMISSIONS;
			for (const pathItem of permission.split(".")) {
				try {
					permAtPath = permAtPath[pathItem];
				} catch {
					console.error(`Permission ${permission} does not exist`);
					return;
				}
			}

			if (!this.updatedPermissions[userID]) {
				this.updatedPermissions[userID] = new Set(this.permissionsData[userID].permissions);
			}

			let modified = false;
			if (value) {
				if (!this.updatedPermissions[userID].has(permission)) {
					modified = true;
				}
				this.updatedPermissions[userID].add(permission);
			} else {
				modified = this.updatedPermissions[userID].delete(permission);
			}

			this.dirtyPermissions ||= modified;
		},
		discardPermChanges() {
			this.updatedPermissions = {};
			this.dirtyPermissions = false;
		},
		async savePermChanges() {
			this.loading.save = true;
			for (const [userID, updatedPerms] of Object.entries(this.updatedPermissions)) {
				try {
					const response = await post("/users/permissions", PERMISSIONS.users.permissions.write, {
						userID,
						permissions: Array.from(updatedPerms)
					});
					console.log(response);
				} catch (e) {
					console.error(e);
				}
			}
			this.discardPermChanges();
			await this.fetchUserPermissions();
			this.loading.save = false;
		}
	},
	mounted() {
		this.fetchUserPermissions();
	}
}
</script>

<style scoped>
.tableStickyShadow {
	box-shadow: 2px 15px 8px 2px var(--color-gray-2);
}
.facadeStickyShadow {
	box-shadow: 2px 15px 8px 2px var(--color-gray-3);
}
</style>