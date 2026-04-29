import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { S3Dao } from "../shared/aws/S3.js";
import { SsmDao } from "../shared/aws/SSM.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Perms.js";
import { Parsers } from "../shared/utils/Parsers.js";

type DeleteFilesBody = {
	pathRoot?: string;
	path?: string;
	fileName?: string;
	isFolder?: boolean;
};

const DB = new DynamoDao();
const S3 = new S3Dao();
const SSM = new SsmDao();

const deleteFileFromInstance = async (instanceId: string, localPath: string): Promise<{ commandId: string; status: string }> => {
	if (!instanceId) {
		throw new Error("instanceId is required");
	}
	if (!localPath) {
		throw new Error("localPath is required");
	}

	const commands = [
		"#!/bin/bash",
		"set -e",
		"",
		`echo \"Deleting: ${localPath}\"`,
		`if [ -e \"${localPath}\" ]; then`,
		`  rm -rf \"${localPath}\"`,
		`  echo \"Successfully deleted ${localPath}\"`,
		"else",
		`  echo \"Path not found: ${localPath}\"`,
		"fi",
	];

	const { commandId } = await SSM.ExecuteCommand(instanceId, commands);
    return {
        commandId,
        status: "pending",
    };
};

export const deleteFiles = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
	const bucketName = process.env.S3_FILESTORE_NAME;

	if (!instanceId) {
		return ResponseUtil.ValidationError("Instance ID is required");
	}
	if (!bucketName) {
		return ResponseUtil.ValidationError("S3 bucket not configured");
	}

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const instanceData = await DB.GetItem(process.env.INSTANCE_TABLE_NAME as string, `inst#${instanceId}`);
	const allowedPaths = new Set(Object.values(instanceData?.validRoots || {}));

	let body: DeleteFilesBody;
	try {
		body = JSON.parse(event.body || "{}") as DeleteFilesBody;
	} catch {
		return ResponseUtil.ValidationError("Request body must be valid JSON");
	}

	const { pathRoot, path, fileName, isFolder } = body;
	if (!pathRoot) {
		return ResponseUtil.ValidationError("pathRoot parameter is required");
	}
	if (!fileName) {
		return ResponseUtil.ValidationError("fileName parameter is required");
	}

	if (!allowedPaths.has(pathRoot)) {
		return ResponseUtil.ValidationError("Invalid pathRoot");
	}

	try {
		const pathComponents = [instanceId, pathRoot.slice(1)];
		if (path) {
			pathComponents.push(path);
		}
		pathComponents.push(fileName);
		const s3Key = pathComponents.join("/");

		if (isFolder) {
			await S3.DeleteFolder(bucketName, s3Key);
		} else {
			await S3.DeleteObject(bucketName, s3Key);
		}

		const baseLocalPath = process.env.BASE_ROOT;
		const filepath = `${pathRoot.slice(1)}${path ? `/${path}` : ""}/${fileName}`;
		const localPath = `${baseLocalPath}/${filepath}`;
		const result = await deleteFileFromInstance(instanceId, localPath);

		await CWLogger.Action(FUNC_NAMES.INST_MGR, {
			userId: Parsers.GetUserSub(event),
			action: "delete-file",
			status: "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { pathRoot, path, fileName, commandId: result.commandId },
		});

		return ResponseUtil.Success({ commandId: result.commandId, s3Key });
	} catch (error) {
		console.error("Delete file error:", error);
		throw error;
	}
};
