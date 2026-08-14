/**
 * Builds `work/names.json` -- the item id -> display name map the rule editor searches.
 *
 * The names cannot come from the game files. Terraria's release build strips `ItemID`'s constants,
 * which were the only id <-> internal-name table that ever existed; the localization JSON embedded in
 * `Terraria.exe` is keyed by internal name, so it is unjoinable on its own. See the README section
 * "Where item names come from" for the full finding. The authoritative source is therefore a running
 * game server: the InventoryMonitor plugin's `/inventory/itemnames` returns `Lang.GetItemNameValue`
 * for every id, which is correct by construction for whatever version that server runs.
 *
 * Two ways to feed it, because the REST port is not reachable from a workstation (it is closed to
 * everything but the VPC, by design -- see the tshock-proxy notes in CLAUDE.md):
 *
 *   # 1. from a saved response -- run the curl on the box, copy the JSON back
 *   npm run names -- --file dump.json
 *
 *   # 2. directly, when this machine *can* reach the server (on the box, or over a tunnel)
 *   TSHOCK_REST_URL=http://localhost:3891 TSHOCK_REST_TOKEN=... npm run names
 *
 * Output is the same either way, and `npm run upload` publishes it beside the atlas under the same
 * immutable version prefix.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("work");

/** Nothing below this is a plausible full item list; a truncated map is worse than none. */
const MIN_EXPECTED_ITEMS = 3000;

function parseArgs(argv) {
	const args = { file: null };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--file") args.file = argv[++i];
	}
	return args;
}

async function fetchDump() {
	const base = process.env.TSHOCK_REST_URL;
	const token = process.env.TSHOCK_REST_TOKEN;

	if (!base || !token) {
		throw new Error(
			"Set TSHOCK_REST_URL and TSHOCK_REST_TOKEN, or pass --file <saved-response.json>.\n" +
			"  On the instance:  curl -s \"http://localhost:3891/inventory/itemnames?token=$TOKEN\" > dump.json",
		);
	}

	const url = `${base.replace(/\/$/, "")}/inventory/itemnames?token=${encodeURIComponent(token)}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`itemnames request failed: ${response.status} ${response.statusText}`);
	}
	return response.json();
}

/**
 * Normalizes the plugin's response.
 *
 * Tolerates both casings on the envelope for the same reason the lambda does: whether TShock's
 * serializer PascalCases a plugin's response keys depends on the build it is running, which is not
 * ours to pin. The `items` map itself is id -> string, so its keys are unaffected.
 */
function normalize(payload) {
	const items = payload.items ?? payload.Items;
	const version = payload.version ?? payload.Version ?? process.env.TERRARIA_VERSION;

	if (!items || typeof items !== "object") {
		throw new Error("response carried no `items` map -- is this the /inventory/itemnames response?");
	}
	if (!version) {
		throw new Error("response carried no `version`, and TERRARIA_VERSION is unset");
	}

	const names = {};
	let skipped = 0;
	for (const [rawId, rawName] of Object.entries(items)) {
		const id = Number(rawId);
		const name = typeof rawName === "string" ? rawName.trim() : "";

		// Id 0 is "no item", and an unnamed id is one the game has no string for -- both would only
		// ever render as noise in a search box.
		if (!Number.isInteger(id) || id === 0 || !name) {
			skipped++;
			continue;
		}
		names[id] = name;
	}

	return { version, names, skipped };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const payload = args.file
		? JSON.parse(await readFile(path.resolve(args.file), "utf8"))
		: await fetchDump();

	const { version, names, skipped } = normalize(payload);
	const ids = Object.keys(names).map(Number);
	const count = ids.length;

	// Loud rather than quiet: a half-empty map still "works", and would leave the editor silently
	// unable to find most items with nothing to explain why.
	if (count < MIN_EXPECTED_ITEMS) {
		throw new Error(`only ${count} names -- expected at least ${MIN_EXPECTED_ITEMS}. Refusing to write a partial map.`);
	}

	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(path.join(OUT_DIR, "names.json"), JSON.stringify({ version, names }));

	console.log(`Source:   ${args.file ? path.resolve(args.file) : process.env.TSHOCK_REST_URL}`);
	console.log(`Version:  ${version}`);
	console.log(`Names:    ${count}${skipped ? `   (skipped ${skipped} unnamed/zero ids)` : ""}`);
	console.log(`Range:    ${Math.min(...ids)} .. ${Math.max(...ids)}`);

	// The atlas is the other half of what the editor renders, so a mismatch is worth seeing here
	// rather than discovering as blank squares in the UI.
	try {
		const atlas = JSON.parse(await readFile(path.join(OUT_DIR, "atlas.json"), "utf8"));
		if (atlas.version !== version) {
			console.log(`\n  ! atlas.json is version ${atlas.version}, this map is ${version}.`);
			console.log(`    They publish under separate prefixes, so the frontend would load one of them from the wrong version.`);
		}
		const spriteIds = Object.keys(atlas.items).map(Number);
		const missingNames = spriteIds.filter(id => !names[id]).length;
		const missingSprites = ids.filter(id => id > 0 && !atlas.items[id]).length;
		console.log(`\nAgainst atlas.json: ${missingNames} sprites with no name, ${missingSprites} named ids with no sprite.`);
	} catch {
		console.log(`\n(no work/atlas.json to cross-check against -- run 'npm run pack' first if you want that)`);
	}

	console.log(`\nWrote work/names.json`);
}

await main();
