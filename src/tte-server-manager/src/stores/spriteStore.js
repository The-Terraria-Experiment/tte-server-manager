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
	}),
	getters: {
		/** False when the env vars aren't set — dev without the atlas published yet, mostly. */
		isConfigured: () => Boolean(SPRITE_BASE_URL && SPRITE_VERSION),
		atlasImageUrl: () => `${SPRITE_BASE_URL}/${SPRITE_VERSION}/atlas.png`,
		atlasMapUrl: () => `${SPRITE_BASE_URL}/${SPRITE_VERSION}/atlas.json`,
		isLoaded: (state) => Boolean(state.atlas),
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
			if (this.atlas || this.loading || this.failed || !this.isConfigured) {
				return this.atlas;
			}

			this.loading = true;

			try {
				// Deliberately a bare fetch rather than util/api.js: this is a public CDN object, not an
				// API Gateway route, so it carries no Cognito token and needs no permission check.
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
	},
});
