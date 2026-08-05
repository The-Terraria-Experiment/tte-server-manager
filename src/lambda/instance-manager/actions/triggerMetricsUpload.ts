import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { SsmDao, isInstanceNotReadyForSsm } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { buildUploadCommand, describeSelftestFailure, parseMetricsStatus } from "../shared/utils/InstanceMetrics.js";

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
		// The uploader can take a few seconds when a manual-mode backlog has built
		// up, so allow a longer poll window than the default before giving up.
		const result = await SSM.ExecuteCommandGetResult(instanceId, buildUploadCommand(selftest), 1000, 45);
		status = parseMetricsStatus(result);
	} catch (error) {
		if (isInstanceNotReadyForSsm(error)) {
			return ResponseUtil.Error(
				"The instance is still starting up. Please wait a moment and try again.",
				409,
				"SSM_NOT_READY",
			);
		}

		// A selftest that fails is a finding about the instance, not a fault in
		// this function — reporting it as a 500 would bury the one piece of
		// information the probe exists to produce. The uploader exits non-zero on a
		// bad probe, which SSM surfaces as a command failure carrying its stderr.
		if (selftest) {
			const detail = describeSelftestFailure(error instanceof Error ? error.message : String(error));

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
