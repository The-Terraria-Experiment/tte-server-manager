import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { S3Dao } from "../shared/aws/S3.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { Assert } from "../shared/utils/Assert.js";

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