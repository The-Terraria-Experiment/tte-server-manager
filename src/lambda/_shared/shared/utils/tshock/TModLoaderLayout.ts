/**
 * Where things live on a tModLoader instance, and how its `serverconfig.txt` is edited.
 *
 * Paths are relative to `BASE_ROOT`, the same convention as `validRoots` and `TSHOCK_PATH`, except
 * the credential file, which is absolute. **`src/instance-scripts/setup/setup.sh` creates exactly
 * this layout** (its `TML_*` variables) — change one, change both, or launches look for files that
 * aren't there.
 *
 * Unlike TShock these are constants rather than env vars: the TShock paths predate the fleet having
 * more than one layout, and one per-function env var per path is what the instance registry was built
 * to get away from. A per-instance override belongs on the `inst#` row if it is ever needed.
 */
export const TML_LAYOUT = {
	/** The unpacked tModLoader release: `tModLoader.dll`, `LaunchUtils/`, its bundled `dotnet/`. */
	installDir: "/tmodloader",
	/**
	 * `-tmlsavedirectory`. tModLoader derives `Worlds/`, `Mods/` and `ModConfigs/` from it. Kept out of
	 * `installDir` so an upgrade (which unpacks a new release over the install) can't touch saves.
	 */
	saveDir: "/tml-save",
	/**
	 * Where `-autocreate` writes worlds. The create command passes `-world` pointing here (without it
	 * tModLoader doesn't generate at all), and the world is saved to
	 * `<saveDir>/Worlds/<worldname>.wld` (verified against tML 1.4.4.9), so this is not a choice.
	 */
	worldsDir: "/tml-save/Worlds",
	/**
	 * Passed with `-config`. Outside `installDir` because every tModLoader release ships a sample
	 * `serverconfig.txt` at its root, and unpacking an upgrade would overwrite ours.
	 */
	configFile: "/tml-save/serverconfig.txt",
	/**
	 * TteControl's REST credential (`{ "username", "password" }`), absolute, root-owned, readable by
	 * the server's user. Deliberately outside every `validRoots` path: anything under a root can be
	 * browsed and downloaded from the Instance Files page, which would put the fleet-wide REST
	 * password in front of every operator with file access and copy it into the S3 filestore.
	 */
	credentialFile: "/etc/tte/tte-control-credential.json",
} as const;

/** The TShock `config.json` counterpart: the app's source of truth for the box's `serverconfig.txt`. */
export const tmlConfigS3Key = (instanceId: string): string => `inst#${instanceId}/serverconfig.txt`;

/**
 * Sets `key=value` lines in a Terraria `serverconfig.txt`, preserving everything else — comments,
 * ordering and keys we don't know about.
 *
 * Replaces the first *active* line for each key (a commented `#password=` is left alone as the
 * documentation it is) and appends keys that weren't present. Terraria reads the file top to bottom
 * with later lines winning, so a duplicate active line further down would override our edit; those
 * are removed rather than left to fight.
 */
export function setServerConfigValues(text: string, updates: Record<string, string | number>): string {
	// The file is line-based, so a value carrying a line break injects config lines of its own. The
	// launch password's validator allows `\s`, which includes newlines — harmless in TShock's JSON,
	// not here.
	for (const [key, value] of Object.entries(updates)) {
		if (/[\r\n]/.test(`${key}${value}`)) {
			throw new Error(`serverconfig.txt value for '${key}' may not contain a line break`);
		}
	}

	const lines = text.length ? text.replace(/\r\n/g, "\n").split("\n") : [];
	const pending = new Map(Object.entries(updates).map(([k, v]) => [k.toLowerCase(), `${k}=${v}`]));
	const written = new Set<string>();
	const out: string[] = [];

	for (const line of lines) {
		const match = /^\s*([^#=\s][^=]*?)\s*=/.exec(line);
		const key = match?.[1]?.toLowerCase();

		if (key && pending.has(key)) {
			if (!written.has(key)) {
				out.push(pending.get(key)!);
				written.add(key);
			}
			continue;
		}
		out.push(line);
	}

	// Drop a trailing empty line before appending so the file doesn't grow a blank line per edit.
	while (out.length && out[out.length - 1] === "") out.pop();
	for (const [key, line] of pending) {
		if (!written.has(key)) out.push(line);
	}

	return out.join("\n") + "\n";
}
