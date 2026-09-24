import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { S3Dao } from "../shared/aws/S3.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Assert } from "../shared/utils/core/Assert.js";
import { getServerFlavor } from "../shared/utils/instance/ServerFlavor.js";
import { readTModLoaderServerConfig } from "../shared/utils/tshock/TShockConfig.js";

/**
 * Which file the response carries, so the config tile knows how to render and validate it:
 * TShock's `config.json` parsed into `file`, or tModLoader's line-based `serverconfig.txt` verbatim
 * in `text` (verbatim so comments and ordering survive a round trip through the editor).
 */
export const CONFIG_FORMATS = { tshockJson: "tshock-json", serverConfigTxt: "serverconfig-txt" } as const;

export const readConfig = async (event: AuthorizedEvent) => {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverId}`);

	const flavor = await getServerFlavor(serverId);
	if (flavor.type === "tmodloader") {
		const text = await readTModLoaderServerConfig(serverId);

		await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "read-config",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { format: CONFIG_FORMATS.serverConfigTxt, isDefaultConfig: text === null },
		});

		// No stored file is not an error: setup.sh seeds one, and every key has a built-in default
		// until then, so an empty editor is an accurate picture of what the server will run with.
		return ResponseUtil.Success({
			format: CONFIG_FORMATS.serverConfigTxt,
			text: text ?? "",
			isDefaultConfig: text === null,
		});
	}

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
		format: CONFIG_FORMATS.tshockJson,
		file: parsedFile,
		isDefaultConfig,
	});
};