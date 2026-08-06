import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { SsmDao, isInstanceNotReadyForSsm } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { blockIfShutdownInProgress } from "../shared/utils/ShutdownJob.js";
import {
	METRICS_SSM_POLL,
	buildApplyCommand,
	parseMetricsStatus,
	validateMetricsConfig,
} from "../shared/utils/InstanceMetrics.js";

const DB = new DynamoDao();
const EC2 = new Ec2Dao();
const SSM = new SsmDao();

/**
 * Applies a metrics collector configuration to the instance, then records it.
 *
 * Order matters: the box is changed first and Dynamo is written only on
 * success, so the stored desired state never claims a setting the instance
 * isn't actually running. A config that couldn't be applied is rejected rather
 * than stored — nothing re-applies stored config at boot, so accepting a write
 * against an offline instance would leave a value that silently never takes.
 */
export const writeMetricsConfig = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const blocked = await blockIfShutdownInProgress(instanceId);
	if (blocked) return blocked;

	const tableName = process.env.INSTANCE_TABLE_NAME;
	if (!tableName) {
		return ResponseUtil.ValidationError("INSTANCE_TABLE_NAME environment variable is required");
	}

	const { valid, errors, config } = validateMetricsConfig(event.parsedBody);
	if (!valid || !config) {
		return ResponseUtil.ValidationError("Invalid metrics configuration", { errors });
	}

	const { state } = await EC2.GetInstanceStatus(instanceId);
	if (state !== InstanceState.RUNNING) {
		return ResponseUtil.Error(
			"The instance must be running to change its metrics configuration.",
			409,
			"INSTANCE_NOT_RUNNING",
		);
	}

	let status;
	try {
		const result = await SSM.ExecuteCommandGetResult(
			instanceId,
			buildApplyCommand(config),
			METRICS_SSM_POLL.intervalMs,
			METRICS_SSM_POLL.maxPolls,
		);
		status = parseMetricsStatus(result);
	} catch (error) {
		if (isInstanceNotReadyForSsm(error)) {
			await CWLogger.Action(FUNC_NAMES.INST_MGR, {
				userId: Parsers.GetUserSub(event),
				action: "write-metrics-config",
				status: "error",
				resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
				details: { instanceId, reason: "ssm-not-ready", state },
			});

			return ResponseUtil.Error(
				"The instance is still starting up. Please wait a moment and try again.",
				409,
				"SSM_NOT_READY",
			);
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

	const appliedAt = new Date().toISOString();
	const appliedBy = Parsers.GetUserSub(event) ?? "unknown";

	await DB.UpdateItem(tableName, `inst#${instanceId}`, {
		updates: {
			metricsConfig: { ...config, appliedAt, appliedBy },
			updatedAt: appliedAt,
		},
	});

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: appliedBy,
		action: "write-metrics-config",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, config, status },
	});

	return ResponseUtil.Success({
		instanceId,
		config,
		appliedAt,
		appliedBy,
		actual: status,
	});
};
