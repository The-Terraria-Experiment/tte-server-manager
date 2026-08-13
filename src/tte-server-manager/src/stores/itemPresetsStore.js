import { defineStore } from "pinia";
import { get } from "../util/api";
import { PERMISSIONS } from "../util/permissionValues";

/**
 * The site-wide library of saved item rulesets.
 *
 * Read-only, like `rolesStore` and `patreonTierMapStore` — writes are posted by the component and
 * followed by a re-fetch, which is the established convention for these site-wide editors.
 *
 * Two levels, because the list endpoint deliberately omits `entries`: `presets` holds summaries for
 * the dropdown, `details` caches full presets keyed by id as they are actually loaded.
 */
export const useItemPresetsStore = defineStore("itempresetsstore", {
	state: () => ({
		presets: [],
		details: {},
		loading: false,
		loadingDetail: {},
	}),
	getters: {
		getPreset: (state) => (presetId) => state.presets.find((preset) => preset.presetId === presetId) || null,
		isLoadingDetail: (state) => (presetId) => Boolean(state.loadingDetail[presetId]),
	},
	actions: {
		async fetchPresets() {
			if (this.loading) return;
			this.loading = true;

			try {
				const response = await get("/system/items/presets", PERMISSIONS.server.player.inventory.rules.read);
				this.presets = response.entries || [];
			} catch (error) {
				console.error(error);
				throw new Error("Failed to fetch item rule presets");
			} finally {
				this.loading = false;
			}
		},
		/**
		 * One preset in full. Cached, since loading the same preset onto several servers in a row is the
		 * normal use — but see `invalidate`: a cached detail is exactly what would make an edited preset
		 * load its pre-edit list.
		 */
		async fetchPreset(presetId) {
			if (!presetId) return null;
			if (this.details[presetId]) return this.details[presetId];
			if (this.loadingDetail[presetId]) return null;

			this.loadingDetail[presetId] = true;

			try {
				const response = await get(
					`/system/items/presets/${encodeURIComponent(presetId)}`,
					PERMISSIONS.server.player.inventory.rules.read
				);
				this.details[presetId] = response.preset || null;
				return this.details[presetId];
			} catch (error) {
				console.error(error);
				throw new Error("Failed to load item rule preset");
			} finally {
				delete this.loadingDetail[presetId];
			}
		},
		/** Called after any write. Drops one preset's cached detail, or the whole cache when given nothing. */
		invalidate(presetId = null) {
			if (presetId) {
				delete this.details[presetId];
				return;
			}
			this.details = {};
		},
	},
});
