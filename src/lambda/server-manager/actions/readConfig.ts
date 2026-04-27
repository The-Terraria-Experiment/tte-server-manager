import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/permissions.js";
import { S3Dao } from "../shared/aws/S3.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Assert } from "../shared/utils/Assert.js";

export const readConfig = async (event: AuthorizedEvent) => {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverId}`);

	const s3 = new S3Dao();
	const bucket = process.env.S3_CONFIG_BUCKET_NAME;
	Assert.IsTruthyString(bucket, "S3 bucket config is missing (S3_CONFIG_BUCKET_NAME not set)");

	let isDefaultConfig = false;
	let configFile = await s3.GetObject(bucket!, `inst#${serverId}/config.json`);

	if (!configFile) {
		const defaultConfig = process.env.S3_DEFAULT_CONFIG;
		if (defaultConfig) {
			configFile = await s3.GetObject(bucket!, defaultConfig);
			isDefaultConfig = true;
		}
	}

	if (!configFile) {
		return ResponseUtil.NotFoundError(`Config file for ${serverId}`);
	}

	let parsedFile: unknown;
	try {
		parsedFile = JSON.parse(configFile);
	} catch {
		return ResponseUtil.Error("Failed to parse JSON. Invalid file.");
	}

	await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-config",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { isDefaultConfig },
	});

	return ResponseUtil.Success({
		file: parsedFile,
		isDefaultConfig,
	});
};