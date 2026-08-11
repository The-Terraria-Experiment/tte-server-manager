/**
 * Decodes Terraria's `Content/Images/Item_*.xnb` into PNGs plus a manifest.
 *
 * The XNBs are LZX-compressed Texture2D (surface format Color / RGBA8888), which the pure-JS `xnb`
 * package decodes without a JVM, a native addon, or a vendored binary -- which is why it's used here
 * over TExtract or TConvert. `Item_<N>` maps 1:1 to ItemID, so the filename carries the key.
 *
 * Usage (from src/sprite-tools/):
 *   npm run extract
 *   TERRARIA_CONTENT=/path/to/Content/Images npm run extract
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { bufferToXnb } from "xnb";
import { findContentImages, findGameVersion, listItemAssets, readArrayBuffer } from "./lib/terraria.mjs";

const OUT_DIR = path.resolve("work");
const PNG_DIR = path.join(OUT_DIR, "png");

/**
 * XNA's content pipeline premultiplies alpha, and no XNB->PNG extractor un-premultiplies on the way
 * out. Rather than assume, this proves it from the data: in premultiplied RGBA no channel can exceed
 * alpha, so a single pixel with R/G/B > A disproves it. Reported at the end of the run.
 */
function surveyAlpha(rgba, survey) {
	for (let i = 0; i < rgba.length; i += 4) {
		const a = rgba[i + 3];
		if (a === 0 || a === 255) {
			if (a === 0) survey.transparent++;
			continue;
		}
		survey.partial++;
		if (rgba[i] > a || rgba[i + 1] > a || rgba[i + 2] > a) {
			survey.exceedsAlpha++;
		}
	}
}

async function main() {
	const imagesDir = findContentImages();
	const version = findGameVersion(imagesDir);
	const assets = await listItemAssets(imagesDir);

	console.log(`Content:  ${imagesDir}`);
	console.log(`Version:  ${version}`);
	console.log(`Assets:   ${assets.length} Item_*.xnb\n`);

	await mkdir(PNG_DIR, { recursive: true });

	const survey = { partial: 0, exceedsAlpha: 0, transparent: 0 };
	const entries = [];
	const failures = [];
	let done = 0;

	for (const asset of assets) {
		try {
			const xnb = bufferToXnb(await readArrayBuffer(asset.file));
			const texture = xnb.content?.export ?? xnb.content;
			const { width, height, data } = texture;

			if (!width || !height || !data) {
				throw new Error("decoded content carried no texture data");
			}

			const rgba = Buffer.from(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length);
			surveyAlpha(rgba, survey);

			await sharp(rgba, { raw: { width, height, channels: 4 } })
				.png({ compressionLevel: 9 })
				.toFile(path.join(PNG_DIR, `Item_${asset.id}.png`));

			entries.push({ id: asset.id, width, height });
		} catch (e) {
			failures.push({ id: asset.id, error: e?.message ?? String(e) });
		}

		if (++done % 500 === 0 || done === assets.length) {
			process.stdout.write(`\r  decoded ${done}/${assets.length}`);
		}
	}
	process.stdout.write("\n\n");

	await writeFile(
		path.join(OUT_DIR, "manifest.json"),
		JSON.stringify({ version, extractedAt: new Date().toISOString(), entries, failures }, null, 2),
	);

	// --- report -------------------------------------------------------------
	const tall = entries.filter(e => e.height > e.width * 1.5);
	console.log(`Decoded:  ${entries.length}   Failed: ${failures.length}`);
	if (failures.length) {
		console.log(`  first failures: ${failures.slice(0, 5).map(f => `Item_${f.id} (${f.error})`).join("; ")}`);
	}

	console.log(`\nAlpha survey`);
	console.log(`  partial-alpha pixels:      ${survey.partial}`);
	console.log(`  with a channel > alpha:    ${survey.exceedsAlpha}`);
	console.log(
		survey.partial === 0
			? "  -> all alpha is binary; premultiplication is unobservable and irrelevant."
			: survey.exceedsAlpha === 0
				? "  -> consistent with PREMULTIPLIED alpha. pack.mjs will un-premultiply."
				: "  -> NOT premultiplied (channels exceed alpha). pack.mjs must leave colour alone.",
	);

	// Deliberately not called "frame strips": most of these are just tall items (spears, swords).
	// Only ~100 are really animated strips, and separating the two needs the pixels, which is
	// pack.mjs's job. Reported here only as a rough sanity check that decoding produced sane shapes.
	console.log(`\nTaller than 1.5x wide: ${tall.length} (pack.mjs identifies which are animated strips)`);
	console.log(`  ${tall.slice(0, 12).map(e => `${e.id}:${e.width}x${e.height}`).join("  ")}`);
	console.log(`\nWrote ${PNG_DIR} and work/manifest.json`);
}

await main();
