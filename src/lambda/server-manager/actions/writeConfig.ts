import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { S3Dao } from "../shared/aws/S3.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { Assert } from "../shared/utils/core/Assert.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import { getServerFlavor } from "../shared/utils/instance/ServerFlavor.js";
import { writeTModLoaderServerConfig } from "../shared/utils/tshock/TShockConfig.js";

/**
 * Upper bound on a `serverconfig.txt`. The stock file with every comment is ~2KB; this exists only so
 * the editor can't be used to park megabytes in the config bucket.
 */
const MAX_SERVERCONFIG_BYTES = 64 * 1024;

const syncConfigToInstance = async (instanceId: string, s3Bucket: string, baseLocalPath: string) => {
	const commands: string[] = [];
	const localPath = `${baseLocalPath}/tshock/config.json`;
	const dirPath = localPath.substring(0, localPath.lastIndexOf("/"));
	const s3 = new S3Dao();
	const presignedUrl = await s3.GetSignedDownloadUrl(s3Bucket, `inst#${instanceId}/config.json`, 3600);

	commands.push("#!/bin/bash");
	commands.push("set -e");
	commands.push("");
	commands.push('echo "Starting file sync from S3"');
	commands.push("");
	commands.push(`echo "Downloading config file to ${localPath}"`);
	commands.push(`mkdir -p "${dirPath}"`);
	commands.push(`chown ubuntu:ubuntu "${dirPath}"`);
	commands.push(`chmod 755 "${dirPath}"`);
	commands.push(`curl --silent --fail --location -o "${localPath}" "${presignedUrl}"`);
	commands.push(`if [ $? -eq 0 ]; then`);
	commands.push(`  chown ubuntu:ubuntu "${localPath}"`);
	commands.push(`  chmod 644 "${localPath}"`);
	commands.push(`  echo "Successfully downloaded config file"`);
	commands.push(`else`);
	commands.push(`  echo "Failed to download config file" >&2`);
	commands.push(`  exit 1`);
	commands.push(`fi`);
	commands.push("");
	commands.push('echo "Completed config file sync"');

	const SSM = new SsmDao();
	return SSM.ExecuteCommand(instanceId, commands);
};

export const writeConfig = async (event: AuthorizedEvent) => {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverId}`);

	const blocked = await blockIfShutdownInProgress(serverId);
	if (blocked) return blocked;

	const flavor = await getServerFlavor(serverId);
	if (flavor.type === "tmodloader") {
		return writeServerConfigTxt(event, serverId);
	}

	let configBody: Record<string, unknown>;
	try {
		const body = JSON.parse(event.body || "{}");
		configBody = body.config;
	} catch {
		return ResponseUtil.ValidationError("Config must be valid JSON");
	}

	if (!configBody || typeof configBody !== "object" || Array.isArray(configBody)) {
		return ResponseUtil.ValidationError("Config payload must be a JSON object");
	}

	const bucket = process.env.S3_CONFIG_BUCKET_NAME;
	const baseLocalPath = process.env.TSHOCK_WD;
	Assert.IsTruthyString(bucket, "S3 bucket config missing (S3_CONFIG_BUCKET_NAME not set)");
	Assert.IsTruthyString(baseLocalPath, "TShock working directory missing (TSHOCK_WD not set)");

	const s3Key = `inst#${serverId}/config.json`;
	const S3 = new S3Dao();

	try {
		await S3.PutJsonObject(bucket!, s3Key, configBody, 2);
		const { commandId } = await syncConfigToInstance(serverId, bucket!, baseLocalPath!);

		await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "write-config",
			status: "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { s3Key, bucket, commandId },
		});

		return ResponseUtil.Success({
			message: "Config updated and sync started",
			commandId,
			s3Key,
		});
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to write config");
	}
};

/**
 * tModLoader's `serverconfig.txt`, written verbatim from the editor (`{ text }`). The whole file is
 * the operator's to edit, so unlike `setServerConfigValues` nothing here parses it — the line-break
 * rejection there protects a single *value* from injecting keys, which doesn't apply when the input
 * is the file. Takes effect on the next launch; there is no live reload.
 */
const writeServerConfigTxt = async (event: AuthorizedEvent, serverId: string) => {
	let text: unknown;
	try {
		text = JSON.parse(event.body || "{}").text;
	} catch {
		return ResponseUtil.ValidationError("Body must be valid JSON");
	}

	if (typeof text !== "string") {
		return ResponseUtil.ValidationError("serverconfig.txt must be sent as a string in `text`");
	}
	if (Buffer.byteLength(text, "utf8") > MAX_SERVERCONFIG_BYTES) {
		return ResponseUtil.ValidationError(`serverconfig.txt may not exceed ${MAX_SERVERCONFIG_BYTES / 1024}KB`);
	}

	// Terraria reads the file on Linux, and a CRLF leaves a trailing \r on every value — which for
	// `password=` means a password no client can type.
	const normalized = text.replace(/\r\n?/g, "\n");

	try {
		const { commandId } = await writeTModLoaderServerConfig(serverId, normalized);

		await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "write-config",
			status: "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { format: "serverconfig-txt", bytes: normalized.length, commandId },
		});

		return ResponseUtil.Success({
			message: "Config updated and sync started. It takes effect on the next launch.",
			commandId,
		});
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to write config");
	}
};
