import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import type { UserDataEntry } from "../shared/schema/UserTable.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { isInstanceNotReadyForSsm } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import {
	TML_UPDATE_IN_PROGRESS_CODE,
	isTmlUpdateBlocking,
	queueTmlUpdateJob,
	readTmlUpdateJob,
	toTmlUpdateState,
} from "../shared/utils/jobs/TModLoaderUpdateJob.js";
import { blockIfUnsupported } from "../shared/utils/instance/ServerFlavor.js";
import {
	type MirroredRelease,
	type TModLoaderRelease,
	TModLoaderReleaseError,
	buildRollbackCommands,
	buildStatusCommands,
	describeBoxFailure,
	fetchLatestStableRelease,
	readMirroredRelease,
	runBoxScript,
} from "../shared/utils/instance/TModLoaderUpdate.js";
import { PERM_TABLE } from "../shared/vars.js";

const EC2 = new Ec2Dao();

/**
 * How long a synchronous box script may run. Sized against API Gateway's 29s integration timeout, like
 * every other synchronous SSM action here (`METRICS_SSM_POLL`, `SYNC_POLL_BUDGET_MS`).
 */
const BOX_SCRIPT_BUDGET_MS = 18000;

const routeOf = (event: AuthorizedEvent) => `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`;

/** Path id, resource access and flavor. Returns a response to send back, or the instance id. */
async function resolveInstance(event: AuthorizedEvent): Promise<string | APIGatewayProxyResult> {
	const instanceId = event.pathParameters?.id;
	if (!instanceId) return ResponseUtil.ValidationError("Instance ID is required");

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const unsupported = await blockIfUnsupported(instanceId, "loaderUpdate");
	if (unsupported) return unsupported;

	return instanceId;
}

async function requireRunning(instanceId: string, doing: string): Promise<APIGatewayProxyResult | null> {
	const { state } = await EC2.GetInstanceStatus(instanceId);
	if (state === InstanceState.RUNNING) return null;
	return ResponseUtil.Error(`Start the instance to ${doing}.`, 409, "INSTANCE_NOT_RUNNING");
}

/** The version of an install, from its own marker or, for setup.sh installs, by matching the mirror's ETag. */
function versionOf(version: unknown, etag: unknown, mirrored: MirroredRelease | null): string | null {
	if (typeof version === "string" && version) return version;
	if (typeof etag === "string" && etag && mirrored?.etag === etag) return mirrored.version;
	return null;
}

/**
 * `GET /instance/{id}/tmodloader`: what's installed, what's latest, and any update job.
 *
 * The box is only asked when the instance is running. A stopped instance reports `box: null` rather
 * than an error, since the GitHub and mirror halves are still useful. GitHub failures are reported in
 * `latestError` for the same reason.
 */
export const readTModLoaderStatus = async (event: AuthorizedEvent, context: Context) => {
	void context;
	const resolved = await resolveInstance(event);
	if (typeof resolved !== "string") return resolved;
	const instanceId = resolved;

	// What the tile polls while a job runs: one GetItem, where the full read costs an SSM command on the box.
	if (event.queryStringParameters?.fields === "job") {
		return ResponseUtil.Success({ instanceId, job: toTmlUpdateState(await readTmlUpdateJob(instanceId)) });
	}

	const [job, mirrored, ec2, latestOutcome] = await Promise.all([
		readTmlUpdateJob(instanceId),
		readMirroredRelease(),
		EC2.GetInstanceStatus(instanceId),
		fetchLatestStableRelease().then(
			(release): { release: TModLoaderRelease | null, error: string | null } => ({ release, error: null }),
			(error): { release: TModLoaderRelease | null, error: string | null } => ({
				release: null,
				error: error instanceof TModLoaderReleaseError ? error.message : "Couldn't look up the latest tModLoader release",
			}),
		),
	]);
	const latest = latestOutcome.release;

	let box: Record<string, unknown> | null = null;
	let boxError: string | null = null;
	if (ec2.state === InstanceState.RUNNING) {
		try {
			const outcome = await runBoxScript(instanceId, buildStatusCommands(), Date.now() + BOX_SCRIPT_BUDGET_MS);
			if (outcome.kind === "done") {
				const r = outcome.result;
				box = {
					installed: r.installed === true,
					version: versionOf(r.version, r.etag, mirrored),
					etag: r.etag || null,
					previousAvailable: r.previousAvailable === true,
					previousVersion: versionOf(r.previousVersion, r.previousEtag, mirrored),
					serverRunning: r.serverRunning === true,
				};
			} else {
				boxError = outcome.kind === "timeout"
					? "The instance didn't answer in time."
					: "The instance couldn't report its tModLoader install.";
			}
		} catch (error) {
			if (!isInstanceNotReadyForSsm(error)) throw error;
			boxError = "The instance is still starting up.";
		}
	}

	// Null means "can't tell". A setup.sh install with no version marker, from a zip that is no longer
	// what's mirrored, has nothing to compare.
	let upToDate: boolean | null = null;
	if (box?.installed && latest) {
		if (mirrored?.version === latest.version && box.etag) {
			upToDate = box.etag === mirrored.etag;
		} else if (box.version) {
			upToDate = box.version === latest.version;
		}
	}

	return ResponseUtil.Success({
		instanceId,
		latest: latest ? { version: latest.version, publishedAt: latest.publishedAt, url: latest.htmlUrl } : null,
		latestError: latestOutcome.error,
		mirrored,
		instanceState: ec2.state,
		box,
		boxError,
		upToDate,
		job: toTmlUpdateState(job),
	});
};

/**
 * `POST /instance/{id}/tmodloader/update`: queues the update and returns at once. The work takes a
 * minute or more (a 60MB mirror, plus a .NET runtime download whenever tML moves runtimes), so it runs
 * on a self-invoked worker like the shutdown job does.
 */
export const queueTModLoaderUpdate = async (event: AuthorizedEvent, context: Context) => {
	const resolved = await resolveInstance(event);
	if (typeof resolved !== "string") return resolved;
	const instanceId = resolved;

	const shuttingDown = await blockIfShutdownInProgress(instanceId);
	if (shuttingDown) return shuttingDown;

	const existing = await readTmlUpdateJob(instanceId);
	if (isTmlUpdateBlocking(existing)) {
		return ResponseUtil.Error("An update is already running on this instance.", 409, TML_UPDATE_IN_PROGRESS_CODE, {
			step: existing?.step ?? null,
			requestedBy: existing?.requestedBy ?? null,
		});
	}

	const notRunning = await requireRunning(instanceId, "update tModLoader");
	if (notRunning) return notRunning;

	const userId = Parsers.GetUserSub(event);
	const user = (await new DynamoDao().GetItem(PERM_TABLE, `user#${userId}`)) as UserDataEntry | null;
	const jobID = await queueTmlUpdateJob(instanceId, user?.displayName || "unknown", context.invokedFunctionArn);

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId,
		action: "tml-update",
		status: "queued",
		resource: routeOf(event),
		details: { instanceId, jobID },
	});

	return ResponseUtil.Success({ instanceId, jobID, job: toTmlUpdateState(await readTmlUpdateJob(instanceId)) });
};

/**
 * `POST /instance/{id}/tmodloader/rollback`: swaps the live install with the one the last update
 * replaced. Per box only. The fleet's `current.zip` still holds the new release, so the next update
 * (or `setup.sh` run) reinstalls it. This is for getting a server back up when a release breaks our
 * mods, not for pinning a version.
 */
export const rollbackTModLoader = async (event: AuthorizedEvent, context: Context) => {
	void context;
	const resolved = await resolveInstance(event);
	if (typeof resolved !== "string") return resolved;
	const instanceId = resolved;

	const shuttingDown = await blockIfShutdownInProgress(instanceId);
	if (shuttingDown) return shuttingDown;

	if (isTmlUpdateBlocking(await readTmlUpdateJob(instanceId))) {
		return ResponseUtil.Error("Wait for the running update to finish before rolling back.", 409, TML_UPDATE_IN_PROGRESS_CODE);
	}

	const notRunning = await requireRunning(instanceId, "roll back tModLoader");
	if (notRunning) return notRunning;

	let outcome;
	try {
		outcome = await runBoxScript(instanceId, buildRollbackCommands(), Date.now() + BOX_SCRIPT_BUDGET_MS);
	} catch (error) {
		if (isInstanceNotReadyForSsm(error)) {
			return ResponseUtil.Error("The instance is still starting up. Please wait a moment and try again.", 409, "SSM_NOT_READY");
		}
		throw error;
	}

	const userId = Parsers.GetUserSub(event);
	if (outcome.kind === "timeout") {
		return ResponseUtil.Error("The rollback is still running on the instance. Refresh in a moment to see the result.", 409, "ROLLBACK_STILL_RUNNING");
	}
	if (outcome.kind === "no-result") {
		await CWLogger.Error(FUNC_NAMES.INST_MGR, {
			userId,
			action: "tml-rollback",
			error: `Rollback ended ${outcome.status} without a result`,
			details: { instanceId, stderr: outcome.stderr },
		});
		return ResponseUtil.Error("The rollback failed on the instance without saying why. Check the instance's SSM command history.", 502, "ROLLBACK_FAILED");
	}
	if (!outcome.result.ok) {
		return ResponseUtil.Error(describeBoxFailure(outcome.result.reason), 409, "ROLLBACK_REFUSED");
	}

	const mirrored = await readMirroredRelease();
	const version = versionOf(outcome.result.version, outcome.result.etag, mirrored);

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId,
		action: "tml-rollback",
		status: "ok",
		resource: routeOf(event),
		details: { instanceId, version },
	});

	return ResponseUtil.Success({ instanceId, rolledBack: true, version });
};
