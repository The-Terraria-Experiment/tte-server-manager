import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { SsmDao, isInstanceNotReadyForSsm, isSsmPollTimeout } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { blockIfShutdownInProgress } from "../shared/utils/ShutdownJob.js";
import {
	METRICS_SSM_POLL,
	buildUploadCommand,
	describeSelftestFailure,
	isCollectorNotInstalled,
	parseMetricsStatus,
} from "../shared/utils/InstanceMetrics.js";

const EC2 = new Ec2Dao();
const SSM = new SsmDao();

/**
 * Forces the instance to push its buffered metrics to S3 now.
 *
 * This is the read-side counterpart to `manual` upload mode: with the upload
 * timer off, S3 only gains new data on shutdown or when someone asks for it
 * here. Deliberately a read-tier permission — it refreshes data, it doesn't
 * change how the instance is configured.
 *
 * `?selftest=true` uploads a single probe object instead of the buffer, to
 * verify the uploader's SigV4 signing and the instance role's S3 access without
 * waiting for a timer to fail silently. Same permission tier for the same
 * reason: it changes no configuration and writes nothing but the probe.
 *
 * A stopped instance needs no trigger; its shutdown flush already ran.
 */
export const triggerMetricsUpload = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	const selftest = event.queryStringParameters?.selftest === "true";

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const blocked = await blockIfShutdownInProgress(instanceId);
	if (blocked) return blocked;

	const { state } = await EC2.GetInstanceStatus(instanceId);
	if (state !== InstanceState.RUNNING) {
		return ResponseUtil.Error(
			"The instance must be running to upload metrics. Metrics from its last session were flushed on shutdown.",
			409,
			"INSTANCE_NOT_RUNNING",
		);
	}

	let status;
	try {
		const result = await SSM.ExecuteCommandGetResult(
			instanceId,
			buildUploadCommand(selftest),
			METRICS_SSM_POLL.intervalMs,
			METRICS_SSM_POLL.maxPolls,
		);
		status = parseMetricsStatus(result);
	} catch (error) {
		if (isInstanceNotReadyForSsm(error)) {
			return ResponseUtil.Error(
				"The instance is still starting up. Please wait a moment and try again.",
				409,
				"SSM_NOT_READY",
			);
		}

		// Checked before the selftest branch: a box with no collector on it says
		// nothing about whether request signing works, so reporting that as a failed
		// probe would blame the uploader for something it was never asked to do.
		if (isCollectorNotInstalled(error)) {
			return ResponseUtil.Error(
				"The metrics collector is not installed on this instance.",
				409,
				"COLLECTOR_NOT_INSTALLED",
			);
		}

		// Running out of poll budget is not a failed upload — the command is still
		// going on the box and will finish. Saying so keeps the user from retrying
		// an upload that already happened. A selftest falls through to the branch
		// below instead, since an inconclusive probe is not a pass.
		if (isSsmPollTimeout(error) && !selftest) {
			return ResponseUtil.Error(
				"The upload is taking longer than expected and is still running on the instance. Refresh in a moment to see the result.",
				409,
				"UPLOAD_STILL_RUNNING",
			);
		}

		// A selftest that fails is a finding about the instance, not a fault in
		// this function — reporting it as a 500 would bury the one piece of
		// information the probe exists to produce. The uploader exits non-zero on a
		// bad probe, which SSM surfaces as a command failure carrying its stderr.
		if (selftest) {
			// An inconclusive probe is not a pass, so a poll timeout still lands
			// here — but it says something different from a rejected PUT, and the
			// raw "SSM command <id> timed out" would be a poor thing to show.
			const detail = isSsmPollTimeout(error)
				? "The probe didn't report back in time, so signing could not be confirmed either way. Try again — if it keeps timing out, check the SSM agent on the instance."
				: describeSelftestFailure(error instanceof Error ? error.message : String(error));

			await CWLogger.Action(FUNC_NAMES.INST_MGR, {
				userId: Parsers.GetUserSub(event),
				action: "metrics-upload-selftest",
				status: "failed",
				resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
				details: { instanceId, detail },
			});

			return ResponseUtil.Error(detail, 409, "SELFTEST_FAILED");
		}

		throw error;
	}

	if (!status) {
		return ResponseUtil.Error(
			"The metrics collector is not installed on this instance.",
			409,
			"COLLECTOR_NOT_INSTALLED",
		);
	}

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: selftest ? "metrics-upload-selftest" : "trigger-metrics-upload",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, selftest, status },
	});

	return ResponseUtil.Success({ instanceId, selftest, actual: status });
};
