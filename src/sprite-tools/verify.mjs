/**
 * Checks a packed atlas without needing a browser. Two things, both worth doing after a Terraria
 * update, because the failure modes here are silent -- a wrong coordinate or a mis-detected frame
 * strip produces a valid PNG that simply shows the wrong picture.
 *
 *   1. Cuts a sample of sprites back out of the atlas and compares them byte-for-byte against the
 *      source PNGs `extract.mjs` wrote. Catches packing/coordinate bugs exactly.
 *   2. Renders `work/contact-sheet.png` -- a grid of well-known items to eyeball. Includes the
 *      canonically animated ones (Fallen Star, the six Souls, the Fragments), which is where frame
 *      cropping shows up: a mis-detected strip renders as a tall smear rather than an icon.
 *
 * Usage (from src/sprite-tools/): npm run verify
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.resolve("work");

/** Ordinary early items, the animated set, some large/late ones, and a few high 1.4.5 IDs. */
const SAMPLE = [
	1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
	75, 520, 521, 547, 548, 549,
	3453, 3454, 3455, 1787,
	29, 58, 109, 149, 169, 489, 502, 757,
	1000, 2000, 3000, 4000, 5000, 6000, 6146, 5644,
	267, 368, 426, 1226,
];

const CELL = 48;
const COLS = 10;

/** Cuts a sprite's rectangle out of the raw atlas buffer. */
function cut(atlasData, atlasWidth, [x, y, w, h]) {
	const out = Buffer.alloc(w * h * 4);
	for (let row = 0; row < h; row++) {
		atlasData.copy(out, row * w * 4, ((y + row) * atlasWidth + x) * 4, ((y + row) * atlasWidth + x + w) * 4);
	}
	return out;
}

async function main() {
	const atlas = JSON.parse(await readFile(path.join(OUT_DIR, "atlas.json"), "utf8"));
	const { data, info } = await sharp(path.join(OUT_DIR, "atlas.png"))
		.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

	console.log(`Version:  ${atlas.version}`);
	console.log(`Atlas:    ${atlas.atlas.w}x${atlas.atlas.h}, ${Object.keys(atlas.items).length} items\n`);

	if (info.width !== atlas.atlas.w || info.height !== atlas.atlas.h) {
		throw new Error(`atlas.png is ${info.width}x${info.height} but atlas.json declares ${atlas.atlas.w}x${atlas.atlas.h}`);
	}

	// --- 1. byte-exact placement check --------------------------------------
	let mismatches = 0;
	let cropChecked = 0;

	for (const id of SAMPLE) {
		const box = atlas.items[id];
		if (!box) {
			console.log(`  Item_${id}: MISSING from atlas`);
			mismatches++;
			continue;
		}

		const [, , w, h] = box;
		const source = await sharp(path.join(OUT_DIR, "png", `Item_${id}.png`))
			.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

		const packed = cut(data, info.width, box);
		// Frame-cropped sprites keep the full width, so a row of the source is directly comparable.
		const expected = source.data.subarray(0, w * h * 4);

		if (!packed.equals(expected)) {
			console.log(`  Item_${id}: MISMATCH at ${box.join(",")}`);
			mismatches++;
		}
		if (source.info.height !== h) {
			cropChecked++;
		}
	}

	console.log(mismatches === 0
		? `Placement: all ${SAMPLE.length} sampled sprites match byte-for-byte (${cropChecked} frame-cropped).`
		: `Placement: ${mismatches} MISMATCHES out of ${SAMPLE.length}.`);

	// --- 2. contact sheet ---------------------------------------------------
	const tiles = [];
	for (let i = 0; i < SAMPLE.length; i++) {
		const box = atlas.items[SAMPLE[i]];
		if (!box) {
			continue;
		}
		const [, , w, h] = box;
		tiles.push({
			input: await sharp(cut(data, info.width, box), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer(),
			left: (i % COLS) * CELL + Math.floor((CELL - w) / 2),
			top: Math.floor(i / COLS) * CELL + Math.floor((CELL - h) / 2),
		});
	}

	const sheetPath = path.join(OUT_DIR, "contact-sheet.png");
	await sharp({
		create: {
			width: COLS * CELL,
			height: Math.ceil(SAMPLE.length / COLS) * CELL,
			channels: 4,
			background: { r: 40, g: 44, b: 52, alpha: 1 },
		},
	}).composite(tiles).png().toFile(sheetPath);

	console.log(`\nWrote ${sheetPath} -- open it. Row 2 starts with Fallen Star and the six Souls;`);
	console.log(`those are animated, so they must read as single icons rather than tall strips.`);

	if (mismatches > 0) {
		process.exitCode = 1;
	}
}

await main();
