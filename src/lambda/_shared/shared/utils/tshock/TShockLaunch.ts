import path from "path";

/**
 * Shared pieces of the shell command that launches TShock, used by both the worldgen (`-autocreate`)
 * and the plain world-launch paths. They build slightly different commands but redirect their output
 * exactly the same way, and the redirect is the fragile part.
 */

/**
 * `pgrep -f` pattern that matches a running TShock/TerrariaServer process.
 *
 * Shared because the two places that ask "is the server up on this box?" — the pre-launch guard and
 * the shutdown-time graceful stop — have to agree on the answer. If the stop's pattern is narrower
 * than the launch guard's, it declares the server gone while it is still writing the world, and the
 * file sync behind it uploads a stale copy.
 *
 * `TSHOCK_PATH` is optional here: not every function that needs the pattern carries it, and the
 * generic names alone are what the pattern has always fallen back to.
 */
export function tshockProcessPattern(): string {
	const binaryName = path.posix
		.basename(String(process.env.TSHOCK_PATH || "").trim())
		.replace(/[^a-zA-Z0-9._-]/g, "");

	return ["TerrariaServer", "TShock", binaryName].filter(Boolean).join("|");
}

/** Roots configured for TShock's stdout/stderr daily logs; empty when logging isn't configured. */
function configuredLogRoots(): string[] {
	return [process.env.TSHOCK_OUT_LOGS, process.env.TSHOCK_ERR_LOGS]
		.map(raw => (raw || "").trim().replace(/\/$/, ""))
		.filter(Boolean);
}

/**
 * `mkdir -p` for every configured log root, or an empty string when none are set.
 *
 * The launch command redirects into these directories with `1>> "<root>/<date>.log"`. Shell
 * redirection creates the *file* but never its parent directory, so a missing root makes the
 * redirect fail before `exec` ever runs — and because the launch is wrapped in `systemd-run`, which
 * reports success as soon as the unit starts, the failure is invisible from the lambda's side. What
 * the caller sees is a server that never started, no world file, and no console output to explain
 * it. Creating the directories at launch keeps a fresh instance from depending on setup.sh having
 * made them.
 */
export function ensureLogDirsCommand(): string {
	const roots = configuredLogRoots();
	if (roots.length === 0) return "";

	const quoted = roots.map(root => `"${root.replace(/"/g, '\\"')}"`).join(" ");
	return `mkdir -p ${quoted}`;
}

/**
 * Joins the fragments of the launched script with `&&`, dropping the empty ones so an unconfigured
 * step can't leave a dangling `&&` that breaks the whole command.
 */
export function joinLaunchSteps(...steps: string[]): string {
	return steps.filter(step => step && step.trim()).join(" && ");
}
