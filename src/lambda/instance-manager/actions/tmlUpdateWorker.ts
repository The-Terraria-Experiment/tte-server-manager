import type { Context } from "aws-lambda";
import type { TmlUpdateRequestData } from "../shared/utils/jobs/TModLoaderUpdateJob.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { boundedWaitDeadline } from "../shared/utils/jobs/SyncBudget.js";
import { tmlUpdateJobKey, writeTmlUpdateProgress } from "../shared/utils/jobs/TModLoaderUpdateJob.js";
import {
	buildInstallCommands,
	describeBoxFailure,
	fetchLatestStableRelease,
	mirrorRelease,
	runBoxScript,
} from "../shared/utils/instance/TModLoaderUpdate.js";

/** Kept back from the install wait for the terminal row write and the log flush. */
const POST_INSTALL_RESERVE_MS = 10000;

/** The install takes a minute or more, so there's no point polling SSM every second. */
const INSTALL_POLL_MS = 3000;

/**
 * Resolves the latest stable tModLoader, mirrors it as the fleet's current release, and installs it on
 * one box. Self-invoked by `queueTModLoaderUpdate`. See `utils/instance/TModLoaderUpdate.ts` for why
 * each step is done the way it is.
 */
export const tmlUpdateWorker = async (event: TmlUpdateRequestData, context: Context) => {
	const { instanceID, jobID, requestedBy } = event;
	const table = process.env.INSTANCE_TABLE_NAME as string;

	// Async invokes are retried up to twice by Lambda. A retry must not run a second install alongside
	// the first, so only the first invocation to claim the row proceeds.
	const claimedAt = new Date().toISOString();
	const claim = await new DynamoDao().UpdateItem(table, tmlUpdateJobKey(instanceID), {
		UpdateExpression: "SET #workerStartedAt = :now, #updatedAt = :now",
		ExpressionAttributeNames: { "#workerStartedAt": "workerStartedAt", "#updatedAt": "updatedAt" },
		ExpressionAttributeValues: { ":now": claimedAt, ":jid": jobID },
		ConditionExpression: "attribute_exists(uid) AND jobID = :jid AND attribute_not_exists(workerStartedAt)",
	});
	if (!claim) {
		return ResponseUtil.Success({ message: "Update already claimed by an earlier worker", instanceID, jobID });
	}

	const fail = async (failureReason: string, details: Record<string, unknown> = {}) => {
		await writeTmlUpdateProgress(instanceID, { status: "failed", step: "failed", failureReason });
		await CWLogger.Error(FUNC_NAMES.INST_MGR, {
			userId: requestedBy,
			action: "tml-update-worker",
			error: failureReason,
			details: { instanceID, jobID, ...details },
		});
		// Returned, not thrown: a throw would have Lambda retry the worker, and the claim makes that a no-op anyway.
		return ResponseUtil.Success({ instanceID, jobID, failed: true, failureReason });
	};

	try {
		await writeTmlUpdateProgress(instanceID, { status: "running", step: "resolving", progress: 10, detail: "Looking up the latest stable release" });
		// Fresh, not cached: the operator pressed the button because something just shipped.
		const release = await fetchLatestStableRelease({ skipCache: true });

		await writeTmlUpdateProgress(instanceID, {
			step: "mirroring",
			progress: 25,
			detail: `Fetching ${release.version}`,
			targetVersion: release.version,
		});
		const mirror = await mirrorRelease(release);

		await writeTmlUpdateProgress(instanceID, { step: "installing", progress: 50, detail: `Installing ${release.version} on the instance` });
		const outcome = await runBoxScript(
			instanceID,
			buildInstallCommands({ key: mirror.key, etag: mirror.etag, version: release.version }),
			boundedWaitDeadline(context, POST_INSTALL_RESERVE_MS),
			INSTALL_POLL_MS,
		);

		if (outcome.kind === "timeout") {
			return await fail("The install is taking longer than expected. It may still finish on the instance. Refresh in a few minutes to check the installed version.");
		}
		if (outcome.kind === "no-result") {
			return await fail("The install failed on the instance without saying why. Check the instance's SSM command history.", { status: outcome.status, stderr: outcome.stderr });
		}
		if (!outcome.result.ok) {
			return await fail(describeBoxFailure(outcome.result.reason), { reason: outcome.result.reason });
		}

		const result = String(outcome.result.result || "installed");
		const fromVersion = typeof outcome.result.from === "string" && outcome.result.from ? outcome.result.from : null;
		await writeTmlUpdateProgress(instanceID, {
			status: "completed",
			step: "completed",
			progress: 100,
			detail: result === "up-to-date" ? `Already on ${release.version}` : `Installed ${release.version}`,
			result,
			...(fromVersion ? { fromVersion } : {}),
		});

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: requestedBy,
			action: "tml-update-worker",
			status: "completed",
			resource: instanceID,
			details: { instanceID, jobID, version: release.version, result, fromVersion, mirror },
		});

		return ResponseUtil.Success({ instanceID, jobID, version: release.version, result });
	} catch (error) {
		return await fail(error instanceof Error ? error.message : String(error));
	}
};
