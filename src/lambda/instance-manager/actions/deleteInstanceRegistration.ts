import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { InstanceRegistry, INSTANCE_KEY_PREFIX } from "../shared/utils/instance/InstanceRegistry.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import { ENVIRONMENTS, SYSTEM_TABLE_BY_ENV } from "../shared/vars.js";
import type { InstanceDataEntry } from "../shared/schema/InstanceTable.js";

const DB = new DynamoDao();
const EC2 = new Ec2Dao();

const AUTO_SHUTOFF_PREFIX = "autoshutoff#";

/** States in which the instance is up, or on its way up, and so must not be deregistered. */
const LIVE_STATES: string[] = [InstanceState.RUNNING, InstanceState.PENDING];

/**
 * `POST /instances/registry/{id}/delete` — remove an instance from the registry entirely.
 *
 * Deletes the whole `inst#<id>` row, so `validRoots`/`worldPaths`/`metricsConfig` go with it; use
 * `PUT /instances/registry/{id}` with a shorter `envs` list to unregister from one environment while
 * keeping the configuration.
 *
 * Also clears the instance's `autoshutoff#<id>` state row from *both* environments' system tables.
 * The registration lives in the shared instance table but auto-shutoff state is per-environment, so
 * deleting only the invoking environment's copy would strand the other one.
 *
 * A POST rather than a DELETE because the frontend's `deleteRequest` helper never attaches a body —
 * the same reason the tier-map and user-permission deletes are POSTs to a `/delete` sub-path.
 */
export const deleteInstanceRegistration = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}

	const tableName = process.env.INSTANCE_TABLE_NAME;
	if (!tableName) {
		return ResponseUtil.ValidationError("INSTANCE_TABLE_NAME environment variable is required");
	}

	const existing = (await DB.GetItem(tableName, `${INSTANCE_KEY_PREFIX}${instanceId}`)) as InstanceDataEntry | null;
	if (!existing) {
		return ResponseUtil.NotFoundError("Instance registration");
	}

	const blocked = await blockIfShutdownInProgress(instanceId);
	if (blocked) return blocked;

	// A running instance deregistered here would keep running with nothing in any UI able to reach
	// it — no status, no stop button, no file access. Make the caller stop it first.
	const [status] = await EC2.GetMultipleInstanceStatus([instanceId]);
	if (status && LIVE_STATES.includes(status.state)) {
		return ResponseUtil.Error(
			"Stop the instance before removing it from the registry.",
			409,
			"INSTANCE_RUNNING",
			{ instanceId, state: status.state },
		);
	}

	const deleted = await DB.DeleteItem(tableName, `${INSTANCE_KEY_PREFIX}${instanceId}`);
	if (!deleted) {
		return ResponseUtil.Error("Failed to delete the instance registration", 500, "REGISTRY_DELETE_FAILED");
	}

	// Best-effort: a leftover auto-shutoff row is inert once the instance is out of the registry
	// (nothing ticks against an unregistered ID), so a failure here must not fail the deregistration.
	const autoShutoffCleanup: Record<string, boolean> = {};
	for (const env of ENVIRONMENTS) {
		autoShutoffCleanup[env] = await DB.DeleteItem(SYSTEM_TABLE_BY_ENV[env], `${AUTO_SHUTOFF_PREFIX}${instanceId}`);
	}

	await InstanceRegistry.BumpCacheVersion();

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event) ?? "unknown",
		action: "delete-instance-registration",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, previousEnvs: existing.envs ?? [], autoShutoffCleanup },
	});

	return ResponseUtil.Success({ instanceId, deleted: true, autoShutoffCleanup });
};
