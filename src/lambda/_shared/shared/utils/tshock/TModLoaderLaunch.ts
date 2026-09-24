import path from "path";
import { Assert } from "../core/Assert.js";
import { dailyLogRedirects, ensureLogDirsCommand, joinLaunchSteps } from "./TShockLaunch.js";
import { TML_LAYOUT } from "./TModLoaderLayout.js";

/**
 * Shell commands that launch a tModLoader dedicated server, for both plain world launch and
 * `-autocreate` worldgen. The TShock counterparts live in `launchWorld.ts`/`beginCreateWorld.ts`.
 *
 * Launched through tModLoader's own `LaunchUtils/ScriptCaller.sh` (what `start-tModLoaderServer.sh`
 * ends up calling), not `dotnet tModLoader.dll` directly: it selects the bundled runtime and applies
 * the platform environment fixes tModLoader expects. It finishes with `exec dotnet tModLoader.dll …`,
 * which is what `gameServerProcessPattern()` matches. Things that are easy to break:
 *
 * - **`-server` and `-nosteam` are mandatory.** Without `-nosteam` the start script asks an
 *   interactive Steam question; ScriptCaller itself doesn't prompt, but the flag also keeps the
 *   server off Steam networking, which a headless EC2 box can't use.
 * - **`-noupnp`,** or it tries to map the port on whatever gateway it finds.
 * - **ScriptCaller sends the server's stderr to `tModLoader-Logs/Natives.log`.** Our `2>>` redirect
 *   only catches the launcher's own output; the game's console (stdout) still reaches the daily log.
 * - **Difficulty is not a command-line option on tModLoader** — only the `difficulty=` config key —
 *   so worldgen difficulty is written into `serverconfig.txt` before launch, like the password.
 * - **World evil has no vanilla option at all.** It travels as `TTE_WORLD_EVIL` in the unit's
 *   environment and TteControl applies it before generation (see `docs/contracts/control-rest.md`,
 *   "Launch-time environment").
 */

export type TModLoaderWorldEvil = "random" | "corrupt" | "crimson";

type BaseLaunchOptions = {
	port: number,
	maxPlayers: number,
};

export type TModLoaderLaunchOptions = BaseLaunchOptions & (
	| { mode: "launch", worldPath: string }
	| { mode: "create", size: number, worldName: string, seed?: string, evil: TModLoaderWorldEvil }
);

const quote = (value: string): string => `"${value.replace(/(["\\$`])/g, "\\$1")}"`;

/** An absolute on-box path from a BASE_ROOT-relative one. */
export function tmlBoxPath(relative: string): string {
	const fsRoot = (process.env.BASE_ROOT || "").replace(/\/$/, "");
	Assert.IsTruthyString(fsRoot, "Filesystem root not configured (BASE_ROOT env var missing)");
	return path.posix.normalize(`${fsRoot}/${relative}`);
}

/**
 * The full `systemd-run …` line for SSM. `worldPath` (launch mode) is BASE_ROOT-relative, as the UI
 * sends it; worldgen needs no path because tModLoader decides it (`TML_LAYOUT.worldsDir`).
 */
export function buildTModLoaderLaunchCommand(options: TModLoaderLaunchOptions): string {
	const installDir = tmlBoxPath(TML_LAYOUT.installDir);

	const args = [
		"-server", "-nosteam", "-noupnp",
		"-tmlsavedirectory", quote(tmlBoxPath(TML_LAYOUT.saveDir)),
		"-config", quote(tmlBoxPath(TML_LAYOUT.configFile)),
	];

	if (options.mode === "launch") {
		args.push("-world", quote(tmlBoxPath(options.worldPath)));
	} else {
		args.push("-autocreate", String(options.size), "-worldname", quote(options.worldName));
		if (options.seed) {
			args.push("-seed", quote(options.seed));
		}
	}
	args.push("-port", String(options.port), "-maxplayers", String(options.maxPlayers));

	// Credential by path, never by value: the environment of a process is readable from /proc by
	// its own user, and a systemd unit's environment is visible to anyone who can `systemctl show` it.
	const env = [`TTE_CONTROL_CREDENTIAL_FILE=${TML_LAYOUT.credentialFile}`];
	if (options.mode === "create") {
		env.push(`TTE_WORLD_EVIL=${options.evil}`);
	}

	const command = `${quote(`${installDir}/LaunchUtils/ScriptCaller.sh`)} ${args.join(" ")}${dailyLogRedirects()}`;
	const serviceScript = joinLaunchSteps(`cd ${quote(installDir)}`, ensureLogDirsCommand(), `exec ${command} < /dev/null`);
	const escapedServiceScript = serviceScript.replace(/'/g, `'"'"'`);
	const setenv = env.map(pair => `--setenv=${pair}`).join(" ");

	return `systemd-run --unit "tml-$(date +%s)-$$" --uid ubuntu --working-directory ${quote(installDir)} ${setenv} --collect --quiet /bin/bash -c '${escapedServiceScript}' && echo "tModLoader launch dispatched"`;
}
