/**
 * Uploads the packed atlas to S3 under an immutable, version-keyed prefix.
 *
 * The keys carry the Terraria version and are never overwritten, so the objects can be served with a
 * one-year immutable cache and the browser never revalidates. Publishing new sprites means uploading
 * a new version prefix and pointing the frontend at it -- there is deliberately no `latest` pointer,
 * because a mutable key is exactly the thing that would force revalidation on every page load.
 *
 * Usage (from src/sprite-tools/):
 *   SPRITE_BUCKET=ttesm-sprites npm run upload
 *
 * Requires ordinary AWS credentials in the environment (the same ones the AWS CLI uses).
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const OUT_DIR = path.resolve("work");
const BUCKET = process.env.SPRITE_BUCKET ?? "ttesm-sprites";
const REGION = process.env.AWS_REGION ?? "us-east-2";
const PREFIX = process.env.SPRITE_PREFIX ?? "sprites/items";
const CACHE_CONTROL = "public, max-age=31536000, immutable";

async function main() {
	const atlasJsonPath = path.join(OUT_DIR, "atlas.json");
	const atlasPngPath = path.join(OUT_DIR, "atlas.png");

	const atlasJson = await readFile(atlasJsonPath, "utf8");
	const atlasPng = await readFile(atlasPngPath);
	const { version, atlas, items } = JSON.parse(atlasJson);

	if (!version || version === "unknown") {
		throw new Error("atlas.json carries no usable version -- set TERRARIA_VERSION and re-run extract+pack.");
	}

	const base = `${PREFIX}/${version}`;
	const client = new S3Client({ region: REGION });

	console.log(`Bucket:   s3://${BUCKET}/${base}/`);
	console.log(`Version:  ${version}`);
	console.log(`Atlas:    ${atlas.w}x${atlas.h}, ${Object.keys(items).length} items, ${((await stat(atlasPngPath)).size / 1024 / 1024).toFixed(2)} MB\n`);

	// The item-name map is optional and versioned separately, because it comes from a running game
	// server rather than the game files (see the README). Publishing it under the same prefix means
	// one env var still points the frontend at both, and a mismatched version is caught here rather
	// than showing up as a search box that can't find anything.
	let namesJson = null;
	try {
		namesJson = await readFile(path.join(OUT_DIR, "names.json"), "utf8");
		const names = JSON.parse(namesJson);
		if (names.version !== version) {
			throw new Error(
				`names.json is version ${names.version} but the atlas is ${version} -- ` +
				`re-run 'npm run names' against a server on ${version}, or upload them separately.`,
			);
		}
		console.log(`Names:    ${Object.keys(names.names).length} items`);
	} catch (e) {
		if (e.code !== "ENOENT") throw e;
		console.log(`Names:    (no work/names.json -- skipping; the rule editor will show bare IDs)`);
	}

	for (const [key, body, contentType] of [
		[`${base}/atlas.png`, atlasPng, "image/png"],
		[`${base}/atlas.json`, atlasJson, "application/json"],
		...(namesJson ? [[`${base}/names.json`, namesJson, "application/json"]] : []),
	]) {
		await client.send(new PutObjectCommand({
			Bucket: BUCKET,
			Key: key,
			Body: body,
			ContentType: contentType,
			CacheControl: CACHE_CONTROL,
		}));
		console.log(`  uploaded ${key}`);
	}

	console.log(`\nPoint the frontend at this version:`);
	console.log(`  VITE_SPRITE_BASE_URL=https://<your-cloudfront-domain>/${PREFIX}`);
	console.log(`  VITE_SPRITE_VERSION=${version}`);
}

await main();
