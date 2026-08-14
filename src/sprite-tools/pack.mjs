/**
 * Packs the extracted item PNGs into a single atlas plus a coordinate map.
 *
 * Two things happen here beyond packing:
 *
 * 1. **Animated items are cropped to frame 0.** Terraria stores animated item sprites as a vertical
 *    frame strip in one `Item_<id>.xnb` -- `Item_75` (Fallen Star) is 22x208, eight 22x24 frames at a
 *    pitch of 26. Packed whole, those render as a tall smear in a square slot. The frame count is not
 *    recorded anywhere in the asset, so it's recovered structurally: Terraria pads each frame with two
 *    transparent rows, so a strip is a height that divides into equal blocks where the last two rows
 *    of *every* block are fully transparent and every block has content. That test finds ~100 items and
 *    lands on exactly the ones that are animated in game (the six Souls, the Fragments, torches), while
 *    leaving tall-but-static items like spears alone. It re-derives itself on each Terraria release
 *    rather than needing a hand-maintained list; `frameOverrides.json` exists for anything it gets wrong.
 *
 * 2. **Colour is left alone.** XNA's content pipeline normally premultiplies alpha, but these assets
 *    measurably are not premultiplied -- 18k pixels carry a colour channel greater than their alpha,
 *    which premultiplication makes impossible. `extract.mjs` re-checks this every run and says so.
 *
 * Usage (from src/sprite-tools/): npm run pack
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.resolve("work");
const PNG_DIR = path.join(OUT_DIR, "png");

/** Atlas width. Height grows to fit. Kept a power of two out of habit; nothing here requires it. */
const ATLAS_WIDTH = Number(process.env.ATLAS_WIDTH ?? 2048);
/** Transparent gutter between packed sprites, so neighbours can't bleed in under scaling. */
const PADDING = 1;

const rowEmpty = (data, width, y) => {
	for (let x = 0; x < width; x++) {
		if (data[(y * width + x) * 4 + 3] !== 0) {
			return false;
		}
	}
	return true;
};

/**
 * Largest frame count for which every equal block ends in two fully-transparent rows and contains
 * some content. Returns null for a normal single-frame sprite.
 */
function detectFrameStrip(data, width, height) {
	if (height < width * 1.2) {
		return null;
	}

	for (let count = Math.floor(height / 4); count >= 2; count--) {
		if (height % count !== 0) {
			continue;
		}
		const pitch = height / count;
		if (pitch < 4) {
			continue;
		}

		let ok = true;
		for (let block = 0; block < count && ok; block++) {
			const top = block * pitch;
			if (!rowEmpty(data, width, top + pitch - 1) || !rowEmpty(data, width, top + pitch - 2)) {
				ok = false;
				break;
			}
			let hasContent = false;
			for (let y = top; y < top + pitch - 2 && !hasContent; y++) {
				if (!rowEmpty(data, width, y)) {
					hasContent = true;
				}
			}
			ok = hasContent;
		}

		if (ok) {
			return { frames: count, frameHeight: pitch - 2 };
		}
	}

	return null;
}

/**
 * Shelf packer: sprites sorted tallest-first, laid left to right, wrapping to a new shelf when the
 * row fills. Near-optimal for a set this uniform (almost everything is a 20-40px icon) and avoids a
 * dependency for what is twenty lines.
 */
function shelfPack(sprites, atlasWidth) {
	const ordered = [...sprites].sort((a, b) => b.height - a.height || b.width - a.width);

	let shelfY = 0;
	let shelfHeight = 0;
	let cursorX = 0;

	for (const sprite of ordered) {
		if (cursorX + sprite.width + PADDING > atlasWidth) {
			shelfY += shelfHeight + PADDING;
			shelfHeight = 0;
			cursorX = 0;
		}
		sprite.x = cursorX;
		sprite.y = shelfY;
		cursorX += sprite.width + PADDING;
		shelfHeight = Math.max(shelfHeight, sprite.height);
	}

	return { width: atlasWidth, height: shelfY + shelfHeight };
}

async function main() {
	if (!existsSync(path.join(OUT_DIR, "manifest.json"))) {
		throw new Error("work/manifest.json not found -- run `npm run extract` first.");
	}

	const { version, entries } = JSON.parse(await readFile(path.join(OUT_DIR, "manifest.json"), "utf8"));
	const overridesPath = path.resolve("frameOverrides.json");
	const overrides = existsSync(overridesPath) ? JSON.parse(await readFile(overridesPath, "utf8")) : {};

	console.log(`Version:  ${version}`);
	console.log(`Sprites:  ${entries.length}`);
	console.log(`Atlas:    ${ATLAS_WIDTH}px wide\n`);

	const sprites = [];
	let cropped = 0;

	for (const entry of entries) {
		const file = path.join(PNG_DIR, `Item_${entry.id}.png`);
		const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

		const override = overrides[String(entry.id)];
		const strip = override
			? { frames: override, frameHeight: entry.height / override - 2 }
			: detectFrameStrip(data, entry.width, entry.height);

		let width = entry.width;
		let height = entry.height;
		let buffer = data;

		if (strip && strip.frameHeight > 0) {
			// Frame 0 is the top `frameHeight` rows, which is exactly the leading run of bytes.
			height = strip.frameHeight;
			buffer = data.subarray(0, width * height * 4);
			cropped++;
		}

		sprites.push({ id: entry.id, width, height, buffer });

		if (sprites.length % 1000 === 0) {
			process.stdout.write(`\r  prepared ${sprites.length}/${entries.length}`);
		}
	}
	process.stdout.write(`\r  prepared ${sprites.length}/${entries.length}\n`);
	console.log(`  cropped ${cropped} animated sprites to frame 0\n`);

	const atlas = shelfPack(sprites, ATLAS_WIDTH);
	console.log(`Packed into ${atlas.width}x${atlas.height}`);

	// Composited by copying rows into a raw buffer rather than via sharp's `composite`. Sprites never
	// overlap, so there is nothing to blend -- and blending is actively harmful here: sharp composites
	// through premultiplied alpha, which clamps each colour channel to its alpha. These assets are not
	// premultiplied and 18k of their pixels carry a channel greater than alpha, so a round trip through
	// `composite` silently rewrites exactly those pixels. A straight memcpy is byte-exact and faster.
	const canvas = Buffer.alloc(atlas.width * atlas.height * 4);
	for (const sprite of sprites) {
		for (let row = 0; row < sprite.height; row++) {
			sprite.buffer.copy(
				canvas,
				((sprite.y + row) * atlas.width + sprite.x) * 4,
				row * sprite.width * 4,
				(row + 1) * sprite.width * 4,
			);
		}
	}

	await sharp(canvas, { raw: { width: atlas.width, height: atlas.height, channels: 4 } })
		.png({ compressionLevel: 9 })
		.toFile(path.join(OUT_DIR, "atlas.png"));

	const items = {};
	for (const sprite of [...sprites].sort((a, b) => a.id - b.id)) {
		items[sprite.id] = [sprite.x, sprite.y, sprite.width, sprite.height];
	}

	await writeFile(
		path.join(OUT_DIR, "atlas.json"),
		JSON.stringify({ version, atlas: { w: atlas.width, h: atlas.height }, items }),
	);

	const { size } = await stat(path.join(OUT_DIR, "atlas.png"));

	console.log(`\nWrote work/atlas.png (${(size / 1024 / 1024).toFixed(2)} MB) and work/atlas.json`);
	console.log(`Decoded in-browser cost: ~${((atlas.width * atlas.height * 4) / 1024 / 1024).toFixed(0)} MB`);
}

await main();
