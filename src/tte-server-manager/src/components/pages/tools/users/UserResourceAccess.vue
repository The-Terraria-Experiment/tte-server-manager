<template>
	<StatusTile
		:permRequired="PERMISSIONS.users.permissions.read"
	>
		<template #header>
			<Icon icon="key" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">User Resource Permissions</p>
		</template>
		<template #content>
			<FuzzyMatchSearch 
				class="ml-4 mb-4"
				placeholder="Filter users..."
				:data="sortedPermissionsData"
				comparisonKey="displayName"
				@update="filteredUserData = $event"
				sortResults
			/>

			<div class="relative z-20 ml-4 text-gray-9 font-main font-bold mb-14 sm:mb-0">
				<p class="text-gray-7">Character Key:</p>
				<p>
					<span class="font-mono font-bold">i:</span> instance
				</p>
				<p>
					<span class="font-mono font-bold">p:</span> file path
				</p>
			</div>

			<div v-if="loading.instances" class="flex items-center m-4">
				<Spinner class="h-4 w-4 text-gray-8" thickness="4" />
				<p class="font-main font-bold text-gray-8 ml-2">Loading...</p>
			</div>
			<div v-else class="grid overflow-x-auto pt-40 relative pr-40 text-sm max-w-max -mt-20" :style="userPermsCols" @scroll="updateUserTableScroll">
				<div :class="['sticky left-0 bg-gray-3 px-4 py-2 flex items-center z-10', stickyShadow]">
					<div class="bg-gray-3 h-60 absolute w-full left-0 bottom-5 z-10 facadeStickyShadow"></div>
					<p class="font-main font-bold text-cream relative z-20">USER</p>
				</div>
				<template v-for="permValue in allPerms">
					<div class="px-2 flex items-center w-20 relative">
						<p class="font-mono text-cream origin-left -rotate-45 absolute left-8 bottom-0 text-nowrap">
							<span class="text-gray-7">{{ permValue.prefix }}</span> 
							<span>{{ permValue.displayText }}</span>
						</p>
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
								:disabled="!$checkPermissions(PERMISSIONS.users.permissions.write)"
								:value="hasAccess(user, permValue)"
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
import { useServerStore } from '../../../../stores/serverStore';
import { post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import Checkbox from '../../../common/Checkbox.vue';
import FuzzyMatchSearch from '../../../common/FuzzyMatchSearch.vue';
import LargeTextInput from '../../../common/LargeTextInput.vue';


export default {
	mixins: [],
	components: {
		LargeTextInput,
		FuzzyMatchSearch,
		Checkbox,
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
			PERMISSIONS,
			BTN_VARIANT,
			updatedPermissions: {},
			dirtyPermissions: false,
			userTableScroll: 0,
			userSelected: null,
			serverStore: useServerStore(),
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
				.map(udata => [udata.userID, { ...udata, resourceAccess: new Set(udata.resourceAccess) }])
				.sort((a, b) => (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', undefined, { numeric: true })));
		},
		userResourcePermissions: {
			get() {
				if (!this.userSelected) return "";

				const currentPermValues = (this.updatedPermissions[this.userSelected]
					? this.updatedPermissions[this.userSelected]
					: this.permissionsData[this.userSelected].resourceAccess).join(",\n")

				return currentPermValues;
			},
			set(value) {
				this.dirtyPermissions = true;

				this.updatedPermissions[this.userSelected] = value.split(",").map(p => p.trim()).filter(p => Boolean(p));
			}
		},
		allPerms() {
			const permList = [];
			const sep = "/";

			this.serverStore.instances.forEach(i => {
				permList.push({
					displayText: `i${sep}${i.name}`,
					prefix: "",
					resourceValues: [`instance::${i.id}`, `server::${i.id}`]
				})

				Object.keys(this.serverStore.instanceFileRoots[i.id] || {}).forEach(p => permList.push({
					displayText: `p${sep}${p}`,
					prefix: `i${sep}${i.name}${sep}`,
					resourceValues: [`filepath::${i.id}::${p}`]
				}));
			});
			
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
		async savePermChanges() {
			this.$emit('saving', true);

			for (const [userID, updatedPerms] of Object.entries(this.updatedPermissions)) {
				try {
					const response = await post("/users/resourcepermissions", PERMISSIONS.users.permissions.write, {
						userID,
						resourceAccess: Array.from(updatedPerms)
					});
					this.$alert.success("Permissions saved");
				} catch (e) {
					this.$alert.error("Error saving permissions");
					console.error(e);
				}
			}
			this.discardPermChanges();
			this.$emit('refresh');
			this.$emit('saving', false);
		},
		discardPermChanges() {
			this.updatedPermissions = {};
			this.dirtyPermissions = false;
		},
		async ensureInstancesLoaded() {
			this.loading.instances = true;
			if (!this.serverStore.instances.length) {
				await this.serverStore.fetchInstanceList();
			}
			await Promise.all(this.serverStore.instances.map(i => {
				if (!this.serverStore.instanceFileRoots[i.id]) {
					return this.serverStore.fetchInstanceFiles(i.id);
				}
			}));
			this.loading.instances = false;
		},
		updateUserTableScroll(event) {
			this.userTableScroll = event.currentTarget.scrollLeft;
		},
		hasAccess(userData, permData) {
			const hasAll = (source) => {
				return permData.resourceValues.every(resource => source.has(resource));
			};

			return this.updatedPermissions?.[userData.userID]
				? hasAll(this.updatedPermissions[userData.userID])
				: hasAll(userData.resourceAccess)
		},
		setUserPerm(userID, permData, value) {
			this.$validatePermissions(PERMISSIONS.users.permissions.write);

			if (!this.updatedPermissions[userID]) {
				this.updatedPermissions[userID] = new Set(this.permissionsData[userID].resourceAccess);
			}

			let modified = false;
			if (value) {
				for (const resource of permData.resourceValues) {
					if (!this.updatedPermissions[userID].has(resource)) {
						modified = true;
					}

					this.updatedPermissions[userID].add(resource);
				}
			} else {
				for (const resource of permData.resourceValues) {
					const didDelete = this.updatedPermissions[userID].delete(resource);
					modified ||= didDelete;
				}
			}

			this.dirtyPermissions ||= modified;
		}
	},
	mounted() {
		this.ensureInstancesLoaded();
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
