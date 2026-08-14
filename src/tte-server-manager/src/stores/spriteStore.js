import { defineStore } from 'pinia';

/**
 * Where the item sprite atlas lives. Produced by `src/sprite-tools/` and published to S3 behind
 * CloudFront under an immutable, version-scoped prefix — so the version is pinned here rather than
 * resolved through a `latest` pointer. A mutable key would force the browser to revalidate a ~1MB
 * image on every load, which is the whole thing the immutable prefix exists to avoid.
 */
const SPRITE_BASE_URL = import.meta.env.VITE_SPRITE_BASE_URL || '';
const SPRITE_VERSION = import.meta.env.VITE_SPRITE_VERSION || '';

export const useSpriteStore = defineStore("spritestore", {
	state: () => ({
		/** { version, atlas: { w, h }, items: { [itemId]: [x, y, w, h] } } */
		atlas: null,
		loading: false,
		/** Set once a load has failed, so slots fall back to name-only rather than retrying per item. */
		failed: false,
		/**
		 * { [itemId]: "Copper Pickaxe" }, published beside the atlas under the same version prefix.
		 *
		 * Loaded separately and only on demand, because only the item rule editor needs it — the
		 * inventory grids get every name they render from the plugin's own report, and making them
		 * wait on another ~150KB fetch would be paying for nothing.
		 */
		names: null,
		namesLoading: false,
		namesFailed: false,
	}),
	getters: {
		/** False when the env vars aren't set — dev without the atlas published yet, mostly. */
		isConfigured: () => Boolean(SPRITE_BASE_URL && SPRITE_VERSION),
		atlasImageUrl: () => `${SPRITE_BASE_URL}/${SPRITE_VERSION}/atlas.png`,
		atlasMapUrl: () => `${SPRITE_BASE_URL}/${SPRITE_VERSION}/atlas.json`,
		itemNamesUrl: () => `${SPRITE_BASE_URL}/${SPRITE_VERSION}/names.json`,
		isLoaded: (state) => Boolean(state.atlas),
		hasNames: (state) => Boolean(state.names),
		/**
		 * An item's display name, or null when the map isn't published or doesn't know the id.
		 *
		 * Null is an ordinary answer, not an error: the map is optional (an older sprite version may
		 * predate it), and an id newer than the published version is expected whenever Terraria updates
		 * before we re-publish. Callers render the bare id.
		 */
		itemName: (state) => (itemId) => state.names?.[itemId] ?? null,
		hasSprite: (state) => (itemId) => Boolean(state.atlas?.items?.[itemId]),
		/**
		 * CSS for a single sprite, drawn as a window onto the atlas.
		 *
		 * The element is sized to the sprite and the atlas is scaled behind it, so one image serves
		 * every slot with no per-item requests. Returns null when the atlas isn't loaded or the ID
		 * isn't in it — an unknown ID is expected whenever the game is newer than the published atlas,
		 * and callers render a labelled placeholder instead.
		 *
		 * `boxSize` is the slot's inner size in px; sprites larger than it are scaled down to fit, and
		 * nothing is ever scaled up (Terraria icons are pixel art and upscaling them just blurs).
		 */
		spriteStyle: (state) => (itemId, boxSize = 32) => {
			const box = state.atlas?.items?.[itemId];
			if (!box) {
				return null;
			}

			const [x, y, w, h] = box;
			const scale = Math.min(1, boxSize / Math.max(w, h));

			return {
				width: `${w * scale}px`,
				height: `${h * scale}px`,
				backgroundImage: `url(${SPRITE_BASE_URL}/${SPRITE_VERSION}/atlas.png)`,
				backgroundPosition: `-${x * scale}px -${y * scale}px`,
				backgroundSize: `${state.atlas.atlas.w * scale}px ${state.atlas.atlas.h * scale}px`,
				backgroundRepeat: 'no-repeat',
			};
		},
	},
	actions: {
		/**
		 * Fetches the coordinate map. Idempotent and safe to call from every mounted slot grid: a
		 * second call while the first is in flight, after it succeeded, or after it failed, all no-op.
		 * The atlas image itself is loaded by the browser when the first slot renders.
		 */
		async loadAtlas() {
			if (this.atlas || this.loading || this.failed) {
				return this.atlas;
			}

			// Falling back to item names is a supported state, not an error — but it looks identical to
			// a broken atlas, so say which one this is. Unset vars are the likeliest cause of "the
			// sprites aren't showing", and Vite inlines these at startup, so a .env change needs a
			// dev-server restart to take effect.
			if (!this.isConfigured) {
				console.warn(
					"[spriteStore] VITE_SPRITE_BASE_URL / VITE_SPRITE_VERSION are not set — " +
					"inventory slots will show item names instead of sprites."
				);
				this.failed = true;
				return null;
			}

			this.loading = true;

			try {
				// Deliberately a bare fetch rather than util/api.js: this is a public CDN object, not an
				// API Gateway route, so it carries no Cognito token and needs no permission check.
				//
				// Do NOT add a `cache: "reload"` retry here. One lived here briefly, on the theory that a
				// CORS failure meant a bad response was stuck in the browser cache under the atlas's
				// one-year `immutable` max-age. It was worse than useless: `cache: "reload"` sends
				// `Cache-Control: no-cache`, and CloudFront silently omits a response headers policy's
				// CORS header on any request carrying a cache-revalidation header — so the "recovery"
				// path was the one request shape guaranteed to fail. That is fixed at the CDN now (S3
				// serves the header itself via a CORS config plus the Managed-CORS-S3Origin origin
				// request policy), but the retry stays gone: cache-busting from the client cannot fix a
				// CDN-side problem, and it made the real cause much harder to see.
				const response = await fetch(this.atlasMapUrl);

				if (!response.ok) {
					throw new Error(`Sprite atlas request failed: ${response.status}`);
				}

				this.atlas = await response.json();
				return this.atlas;
			} catch (error) {
				console.error("Error loading sprite atlas:", error);
				this.failed = true;
				return null;
			} finally {
				this.loading = false;
			}
		},

		/**
		 * Fetches the item-name map. Same idempotence and same supported-unset behaviour as the atlas.
		 *
		 * Called only by the item rule editor, and only when it opens. A 404 here is a normal state
		 * rather than a fault: the map is produced from a running game server (`npm run names` in
		 * src/sprite-tools), so a sprite version published before that step existed simply has no
		 * names.json beside it, and the editor falls back to bare item IDs.
		 */
		async loadItemNames() {
			if (this.names || this.namesLoading || this.namesFailed) {
				return this.names;
			}

			if (!this.isConfigured) {
				this.namesFailed = true;
				return null;
			}

			this.namesLoading = true;

			try {
				// Bare fetch for the same reason loadAtlas uses one — a public CDN object, no token, no
				// permission check. And no cache-busting retry here either: see the long note above.
				const response = await fetch(this.itemNamesUrl);

				if (response.status === 404) {
					console.info(
						`[spriteStore] no names.json published for sprite version ${SPRITE_VERSION} — ` +
						"the item rule editor will show bare item IDs. See src/sprite-tools/README.md."
					);
					this.namesFailed = true;
					return null;
				}
				if (!response.ok) {
					throw new Error(`Item name map request failed: ${response.status}`);
				}

				const payload = await response.json();
				this.names = payload.names ?? null;
				return this.names;
			} catch (error) {
				console.error("Error loading item name map:", error);
				this.namesFailed = true;
				return null;
			} finally {
				this.namesLoading = false;
			}
		},
	},
});
