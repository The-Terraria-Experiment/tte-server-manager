import type { APIGatewayProxyResult, Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { InstanceRegistry, INSTANCE_KEY_PREFIX } from "../shared/utils/InstanceRegistry.js";
import { ENVIRONMENTS, type EnvironmentName } from "../shared/vars.js";
import type { InstanceDataEntry } from "../shared/schema/InstanceTable.js";

const DB = new DynamoDao();
const EC2 = new Ec2Dao();

type RegistryBody = {
	instanceId?: string;
	envs?: string[];
};

/** EC2 instance IDs are `i-` plus 8 (legacy) or 17 hex characters. */
const INSTANCE_ID_PATTERN = /^i-[0-9a-f]{8}(?:[0-9a-f]{9})?$/;

const isValidInstanceId = (instanceId: unknown): instanceId is string =>
	typeof instanceId === "string" && INSTANCE_ID_PATTERN.test(instanceId);

/**
 * Normalises the requested environment list, rejecting anything not in {@link ENVIRONMENTS}.
 * An empty list is legal — it means "keep this instance's config but show it nowhere".
 */
const parseEnvs = (envs: unknown): { valid: boolean; envs: EnvironmentName[]; errors: string[] } => {
	if (!Array.isArray(envs)) {
		return { valid: false, envs: [], errors: ["envs must be an array of environment names"] };
	}

	const errors: string[] = [];
	for (const env of envs) {
		if (!ENVIRONMENTS.includes(env as EnvironmentName)) {
			errors.push(`Unknown environment: ${String(env)}`);
		}
	}

	// Filtered from ENVIRONMENTS rather than the input so the stored order is canonical and deduped.
	const normalized = ENVIRONMENTS.filter((env) => envs.includes(env));
	return { valid: errors.length === 0, envs: [...normalized], errors };
};

const getTableName = (): string | null => process.env.INSTANCE_TABLE_NAME || null;

/**
 * Writes `envs` onto the `inst#<id>` row, then bumps the registry cache version.
 *
 * Uses UpdateItem rather than PutItem so registering an instance can't clobber the `validRoots` /
 * `worldPaths` / `metricsConfig` that setup.sh's register step already wrote on a fresh box — the
 * usual sequence is provision first, register in the UI afterwards.
 */
const applyRegistration = async (
	event: AuthorizedEvent,
	instanceId: string,
	envs: EnvironmentName[],
	name: string | null,
	action: string,
	isNewRegistration: boolean,
): Promise<APIGatewayProxyResult> => {
	const tableName = getTableName();
	if (!tableName) {
		return ResponseUtil.ValidationError("INSTANCE_TABLE_NAME environment variable is required");
	}

	const timestamp = new Date().toISOString();
	const userSub = Parsers.GetUserSub(event) ?? "unknown";

	const updated = await DB.UpdateItem(tableName, `${INSTANCE_KEY_PREFIX}${instanceId}`, {
		updates: {
			envs,
			updatedAt: timestamp,
			// Stamped once, at registration. Rewriting it on every environment edit would destroy the
			// only record of when the instance was first taken on.
			...(isNewRegistration ? { registeredAt: timestamp, registeredBy: userSub } : {}),
			...(name ? { name } : {}),
		},
	});

	if (!updated) {
		return ResponseUtil.Error("Failed to write the instance registration", 500, "REGISTRY_WRITE_FAILED");
	}

	await InstanceRegistry.BumpCacheVersion();

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: userSub,
		action,
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { instanceId, envs },
	});

	return ResponseUtil.Success({
		instanceId,
		envs,
		name: (updated.name as string | undefined) ?? name ?? null,
		registeredAt: (updated.registeredAt as string | undefined) ?? timestamp,
	});
};

/**
 * `POST /instances/registry` — register a new instance.
 *
 * Validates the ID against EC2 before writing. A typo'd or terminated ID stored here would show up
 * as a broken row in every environment it was added to, so it's cheaper to refuse it at entry than
 * to rely on the list tolerating it.
 */
export const createInstanceRegistration = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const { instanceId, envs } = (event.parsedBody ?? {}) as RegistryBody;

	if (!isValidInstanceId(instanceId)) {
		return ResponseUtil.ValidationError("A valid EC2 instance ID is required (e.g. i-0123456789abcdef0)");
	}

	const { valid, envs: parsedEnvs, errors } = parseEnvs(envs);
	if (!valid) {
		return ResponseUtil.ValidationError("Invalid environments", { errors });
	}
	if (parsedEnvs.length === 0) {
		return ResponseUtil.ValidationError("Select at least one environment to register the instance in");
	}

	const tableName = getTableName();
	if (!tableName) {
		return ResponseUtil.ValidationError("INSTANCE_TABLE_NAME environment variable is required");
	}

	const existing = (await DB.GetItem(tableName, `${INSTANCE_KEY_PREFIX}${instanceId}`)) as InstanceDataEntry | null;
	if (existing?.envs && existing.envs.length > 0) {
		return ResponseUtil.Error("That instance is already registered", 409, "ALREADY_REGISTERED", {
			instanceId,
			envs: existing.envs,
		});
	}

	const [status] = await EC2.GetMultipleInstanceStatus([instanceId]);
	if (!status || status.state === InstanceState.MISSING) {
		return ResponseUtil.ValidationError("EC2 has no instance with that ID in this account and region", {
			instanceId,
		});
	}
	if (status.state === InstanceState.TERMINATED) {
		return ResponseUtil.ValidationError("That instance is terminated and cannot be registered", { instanceId });
	}

	return applyRegistration(event, instanceId, parsedEnvs, status.name, "create-instance-registration", true);
};

/**
 * `PUT /instances/registry/{id}` — change which environments an instance belongs to.
 *
 * Also the deregister-from-one-environment path. Doesn't re-validate against EC2: an instance that
 * has since been terminated still has to be editable so it can be moved out of an environment.
 */
export const updateInstanceRegistration = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	if (!isValidInstanceId(instanceId)) {
		return ResponseUtil.ValidationError("A valid EC2 instance ID is required");
	}

	const { envs } = (event.parsedBody ?? {}) as RegistryBody;
	const { valid, envs: parsedEnvs, errors } = parseEnvs(envs);
	if (!valid) {
		return ResponseUtil.ValidationError("Invalid environments", { errors });
	}

	const tableName = getTableName();
	if (!tableName) {
		return ResponseUtil.ValidationError("INSTANCE_TABLE_NAME environment variable is required");
	}

	const existing = (await DB.GetItem(tableName, `${INSTANCE_KEY_PREFIX}${instanceId}`)) as InstanceDataEntry | null;
	if (!existing) {
		return ResponseUtil.NotFoundError("Instance registration");
	}

	// An instance that was never registered has no `registeredAt` yet — treat the first edit that
	// gives it environments as the registration, so the stamp isn't lost for setup.sh-seeded rows.
	const isFirstRegistration = !existing.registeredAt;

	return applyRegistration(
		event,
		instanceId,
		parsedEnvs,
		existing.name ?? null,
		"update-instance-registration",
		isFirstRegistration,
	);
};
