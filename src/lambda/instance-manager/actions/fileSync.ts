import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { S3Dao } from "../shared/aws/S3.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/permissions.js";
import { Parsers } from "../shared/utils/Parsers.js";

const S3 = new S3Dao();
const SSM = new SsmDao();

export const syncFilesToInstance = async (
	instanceId: string,
	s3Bucket: string,
	baseLocalPath?: string,
): Promise<{ commandId: string; filesProcessed: number }> => {
	if (!instanceId) {
		throw new Error("instanceId is required");
	}
	if (!s3Bucket) {
		throw new Error("s3Bucket is required");
	}

	const s3Objects = await S3.ListObjects(s3Bucket, `${instanceId}/`);
	if (s3Objects.length === 0) {
		throw new Error(`No files found in S3 for instance ${instanceId}`);
	}

	const resolvedBasePath = baseLocalPath ?? "/opt/terraria";
	const s3Keys = s3Objects.map((obj) => obj.key);
	const commands: string[] = [
		"#!/bin/bash",
		"set -e",
		"",
		"echo \"Starting file sync from S3\"",
		"",
	];

	for (const s3Key of s3Keys) {
		const filepath = s3Key.substring(instanceId.length + 1);
		const localPath = `${resolvedBasePath}/${filepath}`;
		const dirPath = localPath.substring(0, localPath.lastIndexOf("/"));
		const presignedUrl = await S3.GetSignedDownloadUrl(s3Bucket, s3Key, 3600);

		commands.push(`echo \"Checking ${s3Key}\"`);
		commands.push(`if [ ! -f \"${localPath}\" ]; then`);
		commands.push(`  echo \"Downloading ${s3Key} to ${localPath}\"`);
		commands.push(`  mkdir -p \"${dirPath}\"`);
		commands.push(`  chown ubuntu:ubuntu \"${dirPath}\"`);
		commands.push(`  chmod 755 \"${dirPath}\"`);
		commands.push(`  curl --silent --fail --location -o \"${localPath}\" \"${presignedUrl}\"`);
		commands.push("  if [ $? -eq 0 ]; then");
		commands.push(`    chown ubuntu:ubuntu \"${localPath}\"`);
		commands.push(`    chmod 644 \"${localPath}\"`);
		commands.push(`    echo \"Successfully downloaded ${s3Key}\"`);
		commands.push("  else");
		commands.push(`    echo \"Failed to download ${s3Key}\" >&2`);
		commands.push("    exit 1");
		commands.push("  fi");
		commands.push("else");
		commands.push(`  echo \"File already exists, skipping: ${localPath}\"`);
		commands.push("fi");
		commands.push("");
	}

	commands.push(`echo \"Completed file sync (${s3Keys.length} file(s) checked)\"`);

	const { commandId } = await SSM.ExecuteCommand(instanceId, commands);
    return {
        commandId,
        filesProcessed: s3Keys.length,
    };
};

export const fileSync = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
    if (!instanceId) {
        return ResponseUtil.ValidationError("Instance ID is required");
    }

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	try {
		const baseLocalPath = process.env.BASE_ROOT;
		const bucket = process.env.S3_FILESTORE_NAME;
		if (!bucket) {
			throw new Error("S3_FILESTORE_NAME env var not set");
		}

		const result = await syncFilesToInstance(instanceId, bucket, baseLocalPath);

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "file-sync",
			status: "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { commandId: result.commandId, filesProcessed: result.filesProcessed },
		});

		return ResponseUtil.Success({
			message: "File sync initiated successfully",
			commandId: result.commandId,
			filesProcessed: result.filesProcessed,
		});
	} catch (error) {
		console.error("File sync error:", error);
		throw error;
	}
};
