import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Locates a Steam install of Terraria by reading `libraryfolders.vdf`. Steam spreads libraries
 * across drives, so the default `Program Files (x86)` path is frequently not where the game is.
 * Override with TERRARIA_CONTENT when this guesses wrong or you're on a non-Steam copy.
 */
export function findContentImages() {
	if (process.env.TERRARIA_CONTENT) {
		return process.env.TERRARIA_CONTENT;
	}

	const roots = [
		"C:/Program Files (x86)/Steam",
		"C:/Program Files/Steam",
		`${process.env.HOME ?? ""}/.steam/steam`,
		`${process.env.HOME ?? ""}/Library/Application Support/Steam`,
	];

	const libraries = new Set();
	for (const root of roots) {
		const vdf = path.join(root, "steamapps/libraryfolders.vdf");
		if (!existsSync(vdf)) {
			continue;
		}
		libraries.add(root);
		for (const match of readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)) {
			libraries.add(match[1].replace(/\\\\/g, "/"));
		}
	}

	for (const library of libraries) {
		const images = path.join(library, "steamapps/common/Terraria/Content/Images");
		if (existsSync(images)) {
			return images;
		}
	}

	throw new Error(
		"Could not locate Terraria's Content/Images. Set TERRARIA_CONTENT to it, e.g.\n" +
		'  $env:TERRARIA_CONTENT="D:/SteamLibrary/steamapps/common/Terraria/Content/Images"',
	);
}

/**
 * Reads the game version out of the install so the atlas can be keyed by it. Best-effort: the
 * version only labels the output, so an unknown value is not worth failing the run over. Set
 * TERRARIA_VERSION to override.
 */
export function findGameVersion(imagesDir) {
	if (process.env.TERRARIA_VERSION) {
		return process.env.TERRARIA_VERSION;
	}

	// Content/Images -> Content -> install root
	const root = path.resolve(imagesDir, "../..");
	for (const name of ["Terraria.exe", "Terraria.dll"]) {
		const file = path.join(root, name);
		if (!existsSync(file)) {
			continue;
		}

		// Version strings sit in the PE resource block as UTF-16, and scanning for them beats taking a
		// dependency on a PE parser for one label. But Terraria.exe bundles a dozen other assemblies,
		// each with its own version block: the first ProductVersion/FileVersion in the file belongs to
		// ReLogic and reads 1.0.0.0. Anchor on the block whose InternalName is Terraria to get the real
		// number (1.4.5.6 at time of writing).
		const utf16 = readFileSync(file).toString("utf16le");
		const match = utf16.match(/FileVersion\0\0(\d+\.\d+(?:\.\d+){0,2})\0[\s\S]{0,12}?InternalName\0Terraria/);
		if (match) {
			return match[1];
		}
	}

	return "unknown";
}

/** Every `Item_<id>.xnb` in the images directory, ascending by ID. */
export async function listItemAssets(imagesDir) {
	const entries = await readdir(imagesDir);
	return entries
		.map(name => ({ name, match: /^Item_(\d+)\.xnb$/.exec(name) }))
		.filter(entry => entry.match)
		.map(entry => ({ id: Number(entry.match[1]), file: path.join(imagesDir, entry.name) }))
		.sort((a, b) => a.id - b.id);
}

/** Node Buffer -> ArrayBuffer. Buffers can be views into a shared pool, so the offsets matter. */
export async function readArrayBuffer(file) {
	const buffer = await readFile(file);
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
