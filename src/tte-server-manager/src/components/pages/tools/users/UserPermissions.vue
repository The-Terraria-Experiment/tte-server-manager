<template>
	<StatusTile
		:permRequired="PERMISSIONS.users.permissions.read"
	>
		<template #header>
			<Icon icon="key" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">User Permissions</p>
		</template>
		<template #summary>
			<div class="flex flex-col sm:flex-row gap-4">
				<RefreshButton :loading="loading.permissions" @input="$emit('refreshAll')" />
				<FlexButton
					v-if="$checkPermissions(PERMISSIONS.system.dropcache)"
					:variant="BTN_VARIANT.SECONDARY"
					leftIcon="user-slash"
					@input="dropUserPermCache"
				>
					DROP PERM CACHE
				</FlexButton>
			</div>
		</template>
		<template #content>
			<FuzzyMatchSearch 
				class="z-20 relative -mb-20 ml-4"
				placeholder="Filter users..."
				:data="sortedPermissionsData"
				comparisonKey="displayName"
				@update="filteredUserData = $event"
				sortResults
			/>

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

				<template v-for="(user, idx) of filteredUserData">
					<div :class="['sticky left-0 p-2 flex items-center z-10 overflow-x-auto', stickyShadow, idx%2 ? 'bg-gray-3' : 'bg-gray-4']">
						<p class="font-mono font-semibold text-cream text-nowrap">{{ user.displayName || user.username }}</p>
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
</template>

<script>
import { useUserStore } from '../../../../stores/userStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Checkbox from '../../../common/Checkbox.vue';
import RefreshButton from '../../../common/RefreshButton.vue';
import FuzzyMatchSearch from '../../../common/FuzzyMatchSearch.vue';


export default {
	mixins: [],
	components: {
		Checkbox,
		RefreshButton,
		FuzzyMatchSearch,
	},
	props: {
		loading: {
			type: Object,
			required: true
		},
		allPermissionData: {
			type: [Object, null],
			required: true
		}
	},
	data() {
		return {
			userStore: useUserStore(),
			PERMISSIONS,
			BTN_VARIANT,
			userTableScroll: 0,
			updatedPermissions: {},
			dirtyPermissions: false,
			filteredUserData: [],
		}
	},
	computed: {
		sortedPermissionsData() {
			return Object.values(this.permissionsData)
				.sort((a, b) => (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', undefined, { numeric: true }));
		},
		permissionsData() {
			if (!this.allPermissionData) return [];

			return	Object.fromEntries((this.allPermissionData.entries || [])
				.map(udata => [udata.userID, { ...udata, permissions: new Set(udata.permissions) }])
				.sort((a, b) => (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', undefined, { numeric: true })));
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
		updateUserTableScroll(event) {
			this.userTableScroll = event.currentTarget.scrollLeft;
		},
		setUserPerm(userID, permission, value) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

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
					this.$alert.success("Permissions saved");
					this.$emit("refreshAll");
				} catch (e) {
					this.$alert.error("Error saving permissions");
					console.error(e);
				}
			}
			this.discardPermChanges();
			this.loading.save = false;
		},
		async dropUserPermCache() {
			this.$validatePermissions(PERMISSIONS.system.dropcache);

			try {
				await post("/users/dropcache", PERMISSIONS.system.dropcache);
				this.$alert.success("Permission cache dropped");
			} catch (e) {
				this.$alert.error("Error dropping permission cache");
				console.error(e);
			}
		}
	},
	mounted() {
		this.filteredUserData = this.sortedPermissionsData;
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
