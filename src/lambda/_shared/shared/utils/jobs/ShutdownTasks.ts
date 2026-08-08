import { syncAndPruneTShockLogs } from "../tshock/TShockConsoleLogs.js";
import { syncInstanceFilesToS3 } from "../instance/InstanceFileSync.js";
import { stopTShockServer } from "../tshock/TShockServerStop.js";

/**
 * The ordered work an instance does on its way down, while it is still online and reachable over SSM.
 *
 * This list is the single definition of the shutdown sequence — both the interactive stop and the
 * auto-shutoff countdown run it through the same worker, so a task added here is a task both paths
 * get. It used to live inline in two handlers that each had to fit inside API Gateway's 29s
 * integration timeout, which is why there were only ever two entries and why the first one had to
 * cap itself at half the budget so the second wasn't starved.
 */
export type ShutdownTask = {
	/** Written to the job row as `step`, and mapped to a label by the frontend. Stable — the UI keys off it. */
	id: string;
	/** Human-readable stage name, written to the row as `detail` and used as the UI's fallback label. */
	label: string;
	/**
	 * Wall-clock ceiling for this task alone. Per-task rather than one shared pot so a single stuck
	 * task can't consume the budget of everything behind it. Must stay under the job's staleness
	 * window (see ShutdownJob) — the worker only heartbeats *between* tasks, so a task that can run
	 * longer than that window makes a live job look abandoned.
	 */
	maxMs: number;
	/**
	 * Best-effort by contract: these are expected to log and swallow their own failures rather than
	 * throw, because the instance stops either way and a failed archive must not become a failed
	 * shutdown. The worker records the outcome regardless — see `taskOutcomes`.
	 */
	run: (instanceId: string, deadline: number) => Promise<void>;
};

/**
 * Order is load-bearing, not cosmetic. The graceful server stop has to come first: Terraria keeps the
 * world in memory and only writes it on save, so archiving or syncing ahead of it captures the state
 * as of the last autosave and then overwrites the good copy in S3 with it. Everything after the stop
 * is reading files nothing is still writing.
 */
export const SHUTDOWN_TASKS: ShutdownTask[] = [
	{
		id: "stopping-server",
		label: "Stopping the game server",
		maxMs: 60000,
		run: stopTShockServer,
	},
	{
		id: "archiving-logs",
		label: "Archiving TShock console logs",
		maxMs: 60000,
		run: syncAndPruneTShockLogs,
	},
	{
		id: "syncing-files",
		label: "Syncing tracked instance files",
		maxMs: 120000,
		run: syncInstanceFilesToS3,
	},
];

/** Steps the worker writes that aren't tasks: the queue leg's initial state, and the stop itself. */
export const SHUTDOWN_STEP_QUEUED = "queued";
export const SHUTDOWN_STEP_STOPPING = "stopping-instance";
export const SHUTDOWN_STEP_COMPLETED = "completed";
export const SHUTDOWN_STEP_FAILED = "failed";

/**
 * Progress for the task at `index`, scaled so the task list occupies 10-80% and the EC2 stop that
 * follows it takes the rest. Derived rather than hand-assigned so adding a task doesn't mean
 * renumbering the others.
 */
export function taskProgress(index: number): number {
	if (SHUTDOWN_TASKS.length === 0) return 80;
	return Math.round(10 + (index / SHUTDOWN_TASKS.length) * 70);
}
