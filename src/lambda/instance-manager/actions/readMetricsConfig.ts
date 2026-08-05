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
import {
	METRICS_SSM_POLL,
	buildStatusCommand,
	hasMetricsDrift,
	parseMetricsStatus,
	toMetricsConfig,
	type MetricsStatus,
} from "../shared/utils/InstanceMetrics.js";

const DB = new DynamoDao();
const EC2 = new Ec2Dao();
const SSM = new SsmDao();

/**
 * Reads the metrics collector configuration.
 *
 * The default path is a plain Dynamo read with no SSM round trip and no work on
 * the instance at all — the whole point of persisting desired state is that
 * rendering the UI costs the EC2 box nothing, and that a stopped instance still
 * shows its settings instead of "unknown".
 *
 * `?verify=true` additionally asks the box what it is actually running, for the
 * refresh button. That's opt-in precisely because it isn't free.
 */
export const readMetricsConfig = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const instanceData = await DB.GetItem(process.env.INSTANCE_TABLE_NAME as string, `inst#${instanceId}`);
	const stored = instanceData?.metricsConfig as Record<string, unknown> | undefined;
	const config = toMetricsConfig(stored);

	const verify = event.queryStringParameters?.verify === "true";

	let actual: MetricsStatus | null = null;
	let unreachable: string | null = null;

	if (verify) {
		const { state } = await EC2.GetInstanceStatus(instanceId);

		if (state !== InstanceState.RUNNING) {
			// Not an error: an offline box has nothing to report, and its last
			// shutdown already flushed the buffer to S3.
			unreachable = "instance-offline";
		} else {
			try {
				const result = await SSM.ExecuteCommandGetResult(
					instanceId,
					buildStatusCommand(),
					METRICS_SSM_POLL.intervalMs,
					METRICS_SSM_POLL.maxPolls,
				);
				actual = parseMetricsStatus(result);
				if (!actual) {
					unreachable = "collector-not-installed";
				}
			} catch (error) {
				if (isInstanceNotReadyForSsm(error)) {
					unreachable = "ssm-not-ready";
				} else {
					throw error;
				}
			}
		}
	}

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-metrics-config",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, verify, unreachable, config },
	});

	return ResponseUtil.Success({
		instanceId,
		config,
		appliedAt: (stored?.appliedAt as string) ?? null,
		appliedBy: (stored?.appliedBy as string) ?? null,
		actual,
		unreachable,
		drift: actual ? hasMetricsDrift(config, actual) : null,
	});
};
