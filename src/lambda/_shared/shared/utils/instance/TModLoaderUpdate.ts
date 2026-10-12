import { createHash } from "crypto";
import { PassThrough, Readable, Transform, pipeline } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { S3Dao } from "../../aws/S3.js";
import { SsmDao } from "../../aws/SSM.js";
import { Delay } from "../core/Delay.js";
import { CWLogger } from "../../aws/CloudWatch.js";
import { CW_LOG_GENERAL } from "../../constants.js";
import { gameServerProcessPattern } from "../tshock/TShockLaunch.js";
import { tmlBoxPath } from "../tshock/TModLoaderLaunch.js";
import { TML_LAYOUT } from "../tshock/TModLoaderLayout.js";

/**
 * Self-service tModLoader upgrades: find the newest stable release, mirror it into S3, and install it
 * onto a box.
 *
 * **Why this exists.** Players run tModLoader from Steam, which auto-updates, and a client refuses to
 * join a server on a different version. So every tML release, hotfixes included, leaves every tML
 * server unjoinable until it's upgraded too.
 *
 * **Where releases come from.** GitHub's `/releases/latest`. On 2026-10-11 the release it reported
 * (`v2026.08.3.0`) was built from the same commit as the Steam default branch, which is what players
 * have. The GitHub release is "Monthly Github Auto-release for refs/heads/stable": the same stable
 * branch Steam ships. Tags follow a fixed scheme: `vYYYY.MM.3.N` is stable, including hotfixes, and
 * `vYYYY.MM.2.N` is preview. Previews are flagged prerelease, and so are republished legacy builds
 * (`v2022.09.48.2`, `v0.11.8.11`) that would otherwise look newest by date. `/releases/latest` already
 * skips prereleases, and {@link STABLE_TAG} rejects anything else as a second check.
 *
 * **Why mirror through S3 rather than download straight onto the box.** `setup.sh`'s `tmodloader`
 * step installs from `s3://<TML_RELEASE.bucket>/<TML_RELEASE.currentKey>`, ETag-gated. If boxes
 * upgraded from GitHub behind its back, that pointer would go stale, and the next `setup.sh` run would
 * quietly downgrade the box to the version that just broke. So the mirror is fleet-wide by design:
 * after one update, `current.zip` is the new release for every box and every rebuild.
 */

/**
 * Mirrors `TML_BUCKET`/`TML_KEY` defaults in `src/instance-scripts/setup/setup.sh`. Change one, change
 * both. A box provisioned with `TTE_TML_BUCKET`/`TTE_TML_KEY` overridden reads a different pointer
 * that this never writes.
 */
export const TML_RELEASE = {
	bucket: "ttesm-resources",
	currentKey: "tmodloader/current.zip",
	/** One immutable object per release, `<prefix><tag>.zip`. Boxes download from here, never `current.zip`. */
	releasePrefix: "tmodloader/releases/",
	/** S3 user metadata on both the versioned object and `current.zip` (stored lowercase by S3). */
	versionMetadataKey: "tml-version",
	repo: "tModLoader/tModLoader",
	assetName: "tModLoader.zip",
} as const;

/** Stable-branch release tags (`v2026.08.3.0`). See the module comment for the scheme. */
export const STABLE_TAG = /^v\d{4}\.\d{2}\.3\.\d+$/;

/**
 * The marker files an install carries. `.tte-installed-etag` is the one `setup.sh` writes and gates on,
 * so an install done here is recognised as current by a later `setup.sh` run and vice versa.
 * `.tte-installed-version` exists only on installs done here. `setup.sh` doesn't know the version.
 */
const ETAG_MARKER = ".tte-installed-etag";
const VERSION_MARKER = ".tte-installed-version";

/** Prefix on the one machine-readable line each box script prints. */
const RESULT_PREFIX = "TTE_TML_RESULT ";

export type TModLoaderRelease = {
	version: string,
	publishedAt: string | null,
	htmlUrl: string | null,
	assetUrl: string,
	assetSize: number,
	/** `sha256:<hex>` when GitHub reports one. Verified while streaming when present. */
	assetDigest: string | null,
};

/**
 * How long a GitHub answer is reused within one container. The unauthenticated API allows 60 requests
 * an hour per source IP, and Lambda egress IPs are shared, so every tile load must not cost a request.
 * Ten minutes is short next to how often tML ships.
 */
const LATEST_CACHE_MS = 10 * 60 * 1000;
let latestCache: { at: number, release: TModLoaderRelease } | null = null;

/** Error codes the actions map to 4xx/5xx responses. */
export const TML_UPDATE_ERRORS = {
	GITHUB_UNAVAILABLE: "TML_RELEASE_LOOKUP_FAILED",
	NOT_STABLE: "TML_RELEASE_NOT_STABLE",
} as const;

export class TModLoaderReleaseError extends Error {
	constructor(message: string, public readonly code: string) {
		super(message);
	}
}

/** The newest stable tModLoader release on GitHub. Throws {@link TModLoaderReleaseError}. */
export async function fetchLatestStableRelease(options: { skipCache?: boolean } = {}): Promise<TModLoaderRelease> {
	if (!options.skipCache && latestCache && Date.now() - latestCache.at < LATEST_CACHE_MS) {
		return latestCache.release;
	}

	let response: Response;
	try {
		response = await fetch(`https://api.github.com/repos/${TML_RELEASE.repo}/releases/latest`, {
			headers: { "Accept": "application/vnd.github+json", "User-Agent": "tte-server-manager" },
			signal: AbortSignal.timeout(8000),
		});
	} catch (error) {
		throw new TModLoaderReleaseError(
			`Couldn't reach GitHub to look up the latest tModLoader release: ${error instanceof Error ? error.message : String(error)}`,
			TML_UPDATE_ERRORS.GITHUB_UNAVAILABLE,
		);
	}

	if (!response.ok) {
		const limited = response.status === 403 || response.status === 429;
		throw new TModLoaderReleaseError(
			limited
				? "GitHub is rate-limiting release lookups right now. Try again in a few minutes."
				: `GitHub answered ${response.status} when looking up the latest tModLoader release`,
			TML_UPDATE_ERRORS.GITHUB_UNAVAILABLE,
		);
	}

	const body = await response.json() as {
		tag_name?: string,
		prerelease?: boolean,
		draft?: boolean,
		published_at?: string,
		html_url?: string,
		assets?: { name?: string, browser_download_url?: string, size?: number, digest?: string | null }[],
	};

	const tag = String(body.tag_name || "");
	if (body.prerelease || body.draft || !STABLE_TAG.test(tag)) {
		throw new TModLoaderReleaseError(
			`GitHub's latest tModLoader release is '${tag || "unknown"}', which isn't a stable-branch release. Refusing to install it.`,
			TML_UPDATE_ERRORS.NOT_STABLE,
		);
	}

	const asset = body.assets?.find(a => a.name === TML_RELEASE.assetName);
	if (!asset?.browser_download_url || !asset.size) {
		throw new TModLoaderReleaseError(
			`tModLoader release ${tag} has no ${TML_RELEASE.assetName} asset`,
			TML_UPDATE_ERRORS.GITHUB_UNAVAILABLE,
		);
	}

	const release: TModLoaderRelease = {
		version: tag,
		publishedAt: body.published_at || null,
		htmlUrl: body.html_url || null,
		assetUrl: asset.browser_download_url,
		assetSize: asset.size,
		assetDigest: asset.digest?.startsWith("sha256:") ? asset.digest : null,
	};
	latestCache = { at: Date.now(), release };
	return release;
}

export type MirroredRelease = {
	version: string | null,
	etag: string,
};

/** What `current.zip` holds right now. `version` is null for a zip uploaded by hand without metadata. */
export async function readMirroredRelease(): Promise<MirroredRelease | null> {
	const head = await new S3Dao().HeadObject(TML_RELEASE.bucket, TML_RELEASE.currentKey);
	if (!head) return null;
	return { version: head.metadata[TML_RELEASE.versionMetadataKey] || null, etag: head.etag };
}

export const releaseObjectKey = (version: string): string => `${TML_RELEASE.releasePrefix}${version}.zip`;

/**
 * Makes `release` the fleet's current tModLoader. Idempotent: a release already mirrored isn't
 * downloaded again, and `current.zip` is only rewritten when it holds something else. Two operators
 * updating at once both converge on the same bytes.
 *
 * @returns The versioned key boxes should download, and its ETag, which is also `current.zip`'s.
 */
export async function mirrorRelease(release: TModLoaderRelease): Promise<{ key: string, etag: string, downloaded: boolean, repointed: boolean }> {
	const S3 = new S3Dao();
	const key = releaseObjectKey(release.version);
	const metadata = { [TML_RELEASE.versionMetadataKey]: release.version };

	let downloaded = false;
	let versioned = await S3.HeadObject(TML_RELEASE.bucket, key);
	if (!versioned) {
		await streamReleaseToS3(release, key, metadata);
		downloaded = true;
		versioned = await S3.HeadObject(TML_RELEASE.bucket, key);
		if (!versioned) throw new Error(`Uploaded ${key} but can't read it back`);
	}

	let repointed = false;
	const current = await S3.HeadObject(TML_RELEASE.bucket, TML_RELEASE.currentKey);
	if (current?.etag !== versioned.etag) {
		await S3.CopyObject(TML_RELEASE.bucket, key, TML_RELEASE.currentKey, metadata);
		repointed = true;
	}

	await CWLogger.Action(CW_LOG_GENERAL, {
		userId: null,
		action: "tml-mirror-release",
		status: "ok",
		resource: key,
		details: { version: release.version, etag: versioned.etag, downloaded, repointed, previous: current?.metadata?.[TML_RELEASE.versionMetadataKey] ?? current?.etag ?? null },
	});

	return { key, etag: versioned.etag, downloaded, repointed };
}

/**
 * Streams the GitHub asset straight into S3 without holding the ~60MB zip in memory, and checks it
 * against GitHub's reported size and SHA-256 on the way through. A mismatch deletes the object, because
 * an object at a release key is trusted from then on and never downloaded again.
 */
const UPLOAD_CHUNK_BYTES = 64 * 1024;

async function streamReleaseToS3(release: TModLoaderRelease, key: string, metadata: Record<string, string>): Promise<void> {
	const response = await fetch(release.assetUrl, {
		headers: { "User-Agent": "tte-server-manager" },
		signal: AbortSignal.timeout(120000),
	});
	if (!response.ok || !response.body) {
		throw new Error(`Downloading ${release.assetUrl} failed with HTTP ${response.status}`);
	}

	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > 0 && declared !== release.assetSize) {
		throw new Error(`${release.version} download is ${declared} bytes but GitHub lists the asset at ${release.assetSize}`);
	}

	const hash = createHash("sha256");
	let bytes = 0;
	// Also regroups the download into UPLOAD_CHUNK_BYTES pieces. The SDK sends a stream body with a
	// checksum trailer (aws-chunked), which rejects any chunk under 8KB but the last, and fetch hands
	// back whatever the network delivered, often much smaller.
	let pending: Buffer[] = [];
	let pendingBytes = 0;
	const tap = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			hash.update(chunk);
			bytes += chunk.length;
			pending.push(chunk);
			pendingBytes += chunk.length;
			if (pendingBytes >= UPLOAD_CHUNK_BYTES) {
				this.push(Buffer.concat(pending, pendingBytes));
				pending = [];
				pendingBytes = 0;
			}
			callback();
		},
		flush(callback) {
			if (pendingBytes > 0) this.push(Buffer.concat(pending, pendingBytes));
			callback();
		},
	});
	const body = new PassThrough();
	// pipeline, not pipe: a dropped connection mid-download must fail the upload rather than end the
	// stream early and leave S3 waiting for bytes that will never come.
	pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), tap, body, () => { /* surfaced through the upload */ });

	const S3 = new S3Dao();
	await S3.PutObjectStream(TML_RELEASE.bucket, key, body, release.assetSize, { contentType: "application/zip", metadata });

	const digest = `sha256:${hash.digest("hex")}`;
	const problem = bytes !== release.assetSize
		? `received ${bytes} bytes, expected ${release.assetSize}`
		: (release.assetDigest && release.assetDigest !== digest ? `checksum ${digest} doesn't match GitHub's ${release.assetDigest}` : null);
	if (problem) {
		await S3.DeleteObject(TML_RELEASE.bucket, key);
		throw new Error(`Mirroring ${release.version} failed: ${problem}`);
	}
}

const sq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** The install directory and its two siblings. Same filesystem, so the swap is a pair of renames. */
function installPaths() {
	const install = tmlBoxPath(TML_LAYOUT.installDir);
	return { install, stage: `${install}.new`, prev: `${install}.prev` };
}

/** Shared header for the box scripts: strict mode, paths, and how results and failures are reported. */
function scriptHeader(): string[] {
	const { install, stage, prev } = installPaths();
	return [
		"#!/bin/bash",
		"set -euo pipefail",
		`INSTALL=${sq(install)}`,
		`STAGE=${sq(stage)}`,
		`PREV=${sq(prev)}`,
		`PATTERN=${sq(gameServerProcessPattern())}`,
		// The server's user. Read off the install rather than assumed, falling back to setup.sh's default.
		`OWNER=$(stat -c %U "$INSTALL" 2>/dev/null || echo ubuntu)`,
		`fail() { echo "${RESULT_PREFIX}{\\"ok\\":false,\\"reason\\":\\"$1\\"}"; exit 1; }`,
		// Markers are ours, but they're on disk on a box operators can reach, so only safe characters
		// pass through into JSON.
		`marker() { [ -f "$1/$2" ] && tr -cd 'A-Za-z0-9._-' < "$1/$2" || true; }`,
	];
}

/**
 * Installs the release at `s3://<bucket>/<key>` (ETag `etag`) as the box's tModLoader.
 *
 * The new release is assembled and has its runtime installed in `<install>.new`. Only then is it
 * swapped in, with the old install kept as `<install>.prev` for rollback. Until the two renames at the
 * end, the live install is untouched, so a box stopped mid-update still has a working server. The
 * runtime is seeded from the old install so `InstallDotNet.sh` only downloads when tML changed its .NET
 * version. Its own logic removes a mismatched version, and the runtime is relocatable because
 * tModLoader derives its root from the script's own location.
 *
 * `tModLoader-Logs/` lives inside the install directory, so the launcher's own logs from before the
 * update move to `.prev` with it. The game's console log is elsewhere and unaffected.
 *
 * Every `aws` call runs as `ubuntu` (see the DHMC gotcha in CLAUDE.md). Exit status is meaningful, and
 * the one `TTE_TML_RESULT` line says what happened: `installed` or `up-to-date`, or a failure reason.
 */
export function buildInstallCommands(target: { key: string, etag: string, version: string }): string[] {
	// Hyphen allowed: a hand-uploaded multipart object's ETag is `<md5>-<parts>`.
	if (!/^[A-Za-z0-9-]+$/.test(target.etag)) throw new Error(`Unexpected ETag '${target.etag}'`);
	if (!STABLE_TAG.test(target.version)) throw new Error(`Unexpected version '${target.version}'`);

	const source = `s3://${TML_RELEASE.bucket}/${target.key}`;
	return [
		...scriptHeader(),
		`WANT_ETAG=${sq(target.etag)}`,
		`WANT_VERSION=${sq(target.version)}`,
		`if pgrep -f "$PATTERN" >/dev/null 2>&1; then fail server-running; fi`,
		`if [ -f "$INSTALL/tModLoader.dll" ] && [ "$(marker "$INSTALL" ${ETAG_MARKER})" = "$WANT_ETAG" ]; then`,
		`  printf '%s' "$WANT_VERSION" > "$INSTALL/${VERSION_MARKER}"`,
		`  echo "${RESULT_PREFIX}{\\"ok\\":true,\\"result\\":\\"up-to-date\\"}"; exit 0`,
		"fi",
		`FROM_VERSION=$(marker "$INSTALL" ${VERSION_MARKER})`,
		"TMP=$(mktemp -d)",
		`trap 'rm -rf "$TMP"' EXIT`,
		// The download below runs as ubuntu, whoever owns the install.
		`chown ubuntu "$TMP"`,
		// Captured, not piped, so set -e sees a failed download (the pipeline gotcha in CLAUDE.md).
		`runuser -u ubuntu -- /bin/bash -lc ${sq(`aws s3 cp ${sq(source)} "$0/tml.zip" --only-show-errors`)} "$TMP" || fail download`,
		`unzip -q "$TMP/tml.zip" -d "$TMP/unpacked" || fail unzip`,
		`SRC="$TMP/unpacked"`,
		`if [ ! -f "$SRC/tModLoader.dll" ]; then`,
		`  SRC=$(find "$TMP/unpacked" -maxdepth 2 -name tModLoader.dll -printf '%h\\n' -quit)`,
		`  [ -n "$SRC" ] || fail no-dll-in-zip`,
		"fi",
		`rm -rf "$STAGE"`,
		`mkdir -p "$STAGE"`,
		`cp -a "$SRC/." "$STAGE/"`,
		`if [ -d "$INSTALL/dotnet" ]; then cp -a "$INSTALL/dotnet" "$STAGE/dotnet"; fi`,
		// Zips don't reliably carry the executable bit.
		`chmod +x "$STAGE"/LaunchUtils/*.sh "$STAGE"/*.sh 2>/dev/null || true`,
		`chown -R "$OWNER:$OWNER" "$STAGE"`,
		// Same invocation as setup.sh's step_tmodloader, against the staging copy.
		`runuser -u "$OWNER" -- bash -c 'cd "$1/LaunchUtils" || exit 1; . ./BashUtils.sh; LogFile=/dev/null; . ./DotNetVersion.sh; run_script ./InstallDotNet.sh' _ "$STAGE" >/dev/null 2>&1 || true`,
		`[ -x "$STAGE/dotnet/dotnet" ] || fail runtime-install`,
		`printf '%s' "$WANT_ETAG" > "$STAGE/${ETAG_MARKER}"`,
		`printf '%s' "$WANT_VERSION" > "$STAGE/${VERSION_MARKER}"`,
		`chown "$OWNER:$OWNER" "$STAGE/${ETAG_MARKER}" "$STAGE/${VERSION_MARKER}"`,
		// Checked again right before the swap: the lambda refuses launches while the job runs, but a
		// launch from outside the app is still possible.
		`if pgrep -f "$PATTERN" >/dev/null 2>&1; then rm -rf "$STAGE"; fail server-running; fi`,
		`rm -rf "$PREV"`,
		`if [ -d "$INSTALL" ]; then mv "$INSTALL" "$PREV"; fi`,
		`mv "$STAGE" "$INSTALL"`,
		`echo "${RESULT_PREFIX}{\\"ok\\":true,\\"result\\":\\"installed\\",\\"from\\":\\"$FROM_VERSION\\"}"`,
	];
}

/**
 * Swaps the live install with `<install>.prev`. A swap rather than a restore so rolling back can itself
 * be undone. Runs in well under a second, so it's synchronous rather than a job.
 */
export function buildRollbackCommands(): string[] {
	return [
		...scriptHeader(),
		`if pgrep -f "$PATTERN" >/dev/null 2>&1; then fail server-running; fi`,
		`[ -f "$PREV/tModLoader.dll" ] || fail no-previous-install`,
		`SWAP="$INSTALL.swap"`,
		`rm -rf "$SWAP"`,
		`mv "$INSTALL" "$SWAP"`,
		`mv "$PREV" "$INSTALL"`,
		`mv "$SWAP" "$PREV"`,
		`echo "${RESULT_PREFIX}{\\"ok\\":true,\\"result\\":\\"rolled-back\\",\\"version\\":\\"$(marker "$INSTALL" ${VERSION_MARKER})\\",\\"etag\\":\\"$(marker "$INSTALL" ${ETAG_MARKER})\\"}"`,
	];
}

/** Read-only: what's installed, what rollback would restore, and whether a game server is running. */
export function buildStatusCommands(): string[] {
	return [
		...scriptHeader(),
		`RUNNING=false; if pgrep -f "$PATTERN" >/dev/null 2>&1; then RUNNING=true; fi`,
		`HAS_DLL=false; [ -f "$INSTALL/tModLoader.dll" ] && HAS_DLL=true`,
		`HAS_PREV=false; [ -f "$PREV/tModLoader.dll" ] && HAS_PREV=true`,
		`echo "${RESULT_PREFIX}{\\"ok\\":true,\\"installed\\":$HAS_DLL,\\"version\\":\\"$(marker "$INSTALL" ${VERSION_MARKER})\\",\\"etag\\":\\"$(marker "$INSTALL" ${ETAG_MARKER})\\",\\"previousAvailable\\":$HAS_PREV,\\"previousVersion\\":\\"$(marker "$PREV" ${VERSION_MARKER})\\",\\"previousEtag\\":\\"$(marker "$PREV" ${ETAG_MARKER})\\",\\"serverRunning\\":$RUNNING}"`,
	];
}

export type BoxScriptResult = Record<string, unknown> & { ok: boolean, reason?: string };

/** The `TTE_TML_RESULT` line from a box script's stdout, or null when there isn't one. */
export function parseBoxResult(stdout: string): BoxScriptResult | null {
	const line = stdout.split(/\r?\n/).reverse().find(l => l.startsWith(RESULT_PREFIX));
	if (!line) return null;
	try {
		return JSON.parse(line.slice(RESULT_PREFIX.length)) as BoxScriptResult;
	} catch {
		return null;
	}
}

export type BoxScriptOutcome =
	| { kind: "done", result: BoxScriptResult }
	/** The command ended without printing a result line: the script died somewhere `fail` doesn't cover. */
	| { kind: "no-result", status: string, stderr: string }
	/** We stopped watching. The command is still running on the box. */
	| { kind: "timeout" };

/**
 * Runs a box script and waits for it until `deadline`.
 *
 * Polls `GetCommandResult` itself rather than going through `PollForCommandCompletion`, which throws on
 * a failed command and keeps only `stderr || stdout`. These scripts report failures on stdout and exit
 * non-zero, so any stderr noise along the way (unzip warnings, `InstallDotNet.sh`) would otherwise
 * swallow the one line that says what went wrong.
 */
export async function runBoxScript(instanceId: string, commands: string[], deadline: number, intervalMs = 1000): Promise<BoxScriptOutcome> {
	const SSM = new SsmDao();
	const { commandId } = await SSM.ExecuteCommand(instanceId, commands);

	while (Date.now() + intervalMs < deadline) {
		await new Delay(intervalMs);
		const result = await SSM.GetCommandResult(commandId, instanceId);
		if (["Pending", "InProgress", "Delayed"].includes(result.status)) continue;

		const parsed = parseBoxResult(result.stdout);
		if (parsed) return { kind: "done", result: parsed };
		return { kind: "no-result", status: result.status, stderr: result.stderr.slice(-500) };
	}

	return { kind: "timeout" };
}

/** A box script's failure `reason` as something an operator can act on. */
export function describeBoxFailure(reason: string | undefined): string {
	switch (reason) {
		case "server-running": return "A game server is running on this instance. Stop it first.";
		case "download": return "The instance couldn't download the release from S3. Check the instance role's s3:GetObject on the resources bucket.";
		case "unzip": return "The release zip couldn't be unpacked on the instance.";
		case "no-dll-in-zip": return "The release zip doesn't contain tModLoader.dll.";
		case "runtime-install": return "tModLoader's .NET runtime didn't install. The instance may not be able to reach dot.net.";
		case "no-previous-install": return "There's no previous install on this instance to roll back to.";
		default: return reason ? `The instance reported '${reason}'` : "The instance didn't report a result";
	}
}
