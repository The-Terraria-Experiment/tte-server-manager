<template>
	<StatusTile
		:permRequired="PERMISSIONS.users.permissions.read"
	>
		<template #header>
			<Icon icon="key" color="text-gray-6" size="4" />
			<p class="text-gray-6 ml-2 text-lg">User Resource Permissions</p>
		</template>
		<template #content>
			<div class="flex text-sm">
				<div class="w-1/4 max-h-50 overflow-y-auto">
					<template v-for="(user, idx) of sortedPermissionsData">
						<div 
							:class="[
								'w-full p-2 sm:hover:bg-gray-5 cursor-pointer',
								userSelected === user.userID ? 'bg-teal-1' : (idx % 2 ? 'bg-gray-3' : 'bg-gray-4')
							]"
							@click="userSelected = user.userID"
						>
							<p class="font-mono font-semibold text-cream overflow-x-auto text-nowrap">{{ user.displayName || user.username }}</p>
						</div>
					</template>
				</div>
				<div class="w-3/4 pr-2 font-mono pb-2 text-xs sm:text-md">
					<LargeTextInput 
						placeholder="Select a user to view resource permissions"
						class="min-h-40 w-full rounded" 
						wrap="off"
						v-model="userResourcePermissions"
					/>
				</div>
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
import { post } from '../../../../util/api';
import { BTN_VARIANT } from '../../../../util/constants';
import { PERMISSIONS } from '../../../../util/permissionValues';
import LargeTextInput from '../../../common/LargeTextInput.vue';


export default {
	mixins: [],
	components: {
		LargeTextInput,
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
			userSelected: null,
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
				.map(udata => [udata.userID, { ...udata }])
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
	},
}
</script>

<style scoped>

</style>
