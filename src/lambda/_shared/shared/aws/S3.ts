import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CWLogger } from "./CloudWatch.js";
import { SsmDao } from "./SSM.js";
import { CW_LOG_GENERAL } from "../constants.js";

export interface S3ObjectSummary {
	key: string;
	size: number;
	lastModified: Date | undefined;
}

export class S3Dao {
	private static instance: S3Dao | null = null;
	private readonly s3Client!: S3Client;
	private readonly ssmDao!: SsmDao;

	constructor(region = process.env.AWS_REGION, ssmDao = new SsmDao(region)) {
		if (S3Dao.instance) {
			return S3Dao.instance;
		}

		this.s3Client = new S3Client({ region: region || "us-east-2" });
		this.ssmDao = ssmDao;
		S3Dao.instance = this;
	}

	public async PutJsonObject(bucketName: string, key: string, payload: unknown, spacing = 2): Promise<void> {
		const command = new PutObjectCommand({
			Bucket: bucketName,
			Key: key,
			Body: JSON.stringify(payload, null, spacing),
			ContentType: "application/json",
		});

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-put-json-object",
			resource: null,
			details: { bucketName, key },
		});

		await this.s3Client.send(command);
	}

	public async PutTextObject(bucketName: string, key: string, payload: string, contentType = "text/plain; charset=utf-8"): Promise<void> {
		const command = new PutObjectCommand({
			Bucket: bucketName,
			Key: key,
			Body: payload,
			ContentType: contentType,
		});

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-put-text-object",
			resource: null,
			details: { bucketName, key, contentType },
		});

		await this.s3Client.send(command);
	}

	public async ListObjects(bucketName: string, prefix = ""): Promise<S3ObjectSummary[]> {
		const command = new ListObjectsV2Command({
			Bucket: bucketName,
			Prefix: prefix,
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-list-s3-objects",
			resource: null,
			details: { bucketName, prefix },
		});

		const response = await this.s3Client.send(command);
		if (!response.Contents || response.Contents.length === 0) {
			return [];
		}

		return response.Contents.map((obj) => ({
			key: obj.Key || "",
			size: obj.Size ?? 0,
			lastModified: obj.LastModified,
		}));
	}

	public async GetObject(bucketName: string, key: string): Promise<string | false> {
		try {
			const command = new GetObjectCommand({
				Bucket: bucketName,
				Key: key,
			});

			await CWLogger.CAction(2, CW_LOG_GENERAL, {
				userId: null,
				action: "shared-aws-get-s3-object",
				resource: null,
				details: { bucketName, key },
			});

			const response = await this.s3Client.send(command);
			if (!response.Body) {
				return false;
			}

			return await response.Body.transformToString();
		} catch (error) {
			const err = error as { name?: string };
			if (err.name === "NoSuchKey") {
				return false;
			}
			throw error;
		}
	}

	public async GetSignedUploadUrl(bucketName: string, key: string, expiresIn = 3600): Promise<string> {
		const command = new PutObjectCommand({
			Bucket: bucketName,
			Key: key,
		});

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-get-signed-upload-url",
			resource: null,
			details: { bucketName, key, expiresIn },
		});

		return getSignedUrl(this.s3Client, command, { expiresIn });
	}

	public async GetSignedDownloadUrl(bucketName: string, key: string, expiresIn = 3600, fileName?: string): Promise<string> {
		const command = new GetObjectCommand({
			Bucket: bucketName,
			Key: key,
			ResponseContentDisposition: `attachment; filename="${fileName ?? key.split("/").pop()}"`,
		});

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-get-signed-download-url",
			resource: null,
			details: { bucketName, key, expiresIn },
		});

		return getSignedUrl(this.s3Client, command, { expiresIn });
	}

	public async DeleteObject(bucketName: string, key: string): Promise<void> {
		const command = new DeleteObjectCommand({
			Bucket: bucketName,
			Key: key,
		});

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-delete-s3-object",
			resource: null,
			details: { bucketName, key },
		});

		await this.s3Client.send(command);
	}

	public async DeleteFolder(bucketName: string, prefix: string): Promise<{ deleted: number }> {
		const listCommand = new ListObjectsV2Command({
			Bucket: bucketName,
			Prefix: prefix,
		});

		const response = await this.s3Client.send(listCommand);
		if (!response.Contents || response.Contents.length === 0) {
			await CWLogger.CAction(2, CW_LOG_GENERAL, {
				userId: null,
				action: "shared-aws-delete-s3-folder",
				resource: null,
				details: { bucketName, prefix, deletedCount: 0 },
			});

			return { deleted: 0 };
		}

		const deleteCommand = new DeleteObjectsCommand({
			Bucket: bucketName,
			Delete: {
				Objects: response.Contents.map((obj) => ({ Key: obj.Key })),
			},
		});

		await this.s3Client.send(deleteCommand);
		const deletedCount = response.Contents.length;

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-delete-s3-folder",
			resource: null,
			details: { bucketName, prefix, deletedCount },
		});

		return { deleted: deletedCount };
	}

	public async SyncInstanceFileToS3(
		instanceId: string,
		filePath: string,
		bucketName: string,
		key: string,
	): Promise<{ commandId: string }> {
		return this.SyncInstanceFilesToS3({
			instanceId,
			bucketName,
			files: [{ localPath: filePath, destinationKey: key }],
		});
	}

	/**
	 * Executes SSM commands to sync multiple files from an instance to S3.
	 */
	public async SyncInstanceFilesToS3(params: {
		instanceId: string;
		bucketName: string;
		files: Array<{ localPath: string; destinationKey: string }>;
	}): Promise<{ commandId: string }> {
		const { instanceId, bucketName, files } = params;

		if (!instanceId) {
			throw new Error("instanceId is required");
		}
		if (!bucketName) {
			throw new Error("bucketName is required");
		}
		if (!files || files.length === 0) {
			throw new Error("files is required");
		}

		const escapedBucket = bucketName.replace(/"/g, "\\\"");
		const commands: string[] = [
			"#!/bin/bash",
			"set -e",
			"",
			`echo \"Starting S3 upload (${files.length} file(s))\"`,
			"",
		];

		for (const file of files) {
			if (!file.localPath || !file.destinationKey) {
				throw new Error("Each file requires localPath and destinationKey");
			}

			const escapedLocalPath = file.localPath.replace(/"/g, "\\\"");
			const trimmedKey = file.destinationKey.replace(/^\/+/, "");
			const escapedKey = trimmedKey.replace(/"/g, "\\\"");
			const s3Uri = `s3://${escapedBucket}/${escapedKey}`;

			commands.push(`if [ -f \"${escapedLocalPath}\" ]; then`);
			commands.push(
				`  runuser -u ubuntu -- /bin/bash -lc "aws s3 cp \\\"${escapedLocalPath}\\\" \\\"${s3Uri}\\\" --only-show-errors"`,
			);
			commands.push(`  echo \"Uploaded: ${escapedKey}\"`);
			commands.push("else");
			commands.push(`  echo \"Missing local file, skipping: ${escapedLocalPath}\"`);
			commands.push("fi");
			commands.push("");
		}

		commands.push("echo \"Completed S3 upload\"");

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-sync-instance-files-to-s3",
			resource: null,
			details: { instanceId, bucketName, fileCount: files.length },
		});

		return this.ssmDao.ExecuteCommand(instanceId, commands);
	}

	/**
	 * Executes SSM commands to sync a file or folder from an instance to S3.
	 * For folders, destinationKey is treated as a prefix.
	 */
	public async SyncInstanceToS3(params: {
		instanceId: string;
		localPath: string;
		bucketName: string;
		destinationKey?: string;
		isFolder?: boolean;
	}): Promise<{ commandId: string }> {
		const { instanceId, localPath, bucketName, destinationKey } = params;
		const isFolder = params.isFolder ?? false;

		if (!instanceId) {
			throw new Error("instanceId is required");
		}
		if (!localPath) {
			throw new Error("localPath is required");
		}
		if (!bucketName) {
			throw new Error("bucketName is required");
		}
		if (!destinationKey && !isFolder) {
			throw new Error("destinationKey is required for file sync");
		}

		const trimmedKey = (destinationKey ?? "").replace(/^\/+/, "");
		const normalizedKey = isFolder && trimmedKey && !trimmedKey.endsWith("/") ? `${trimmedKey}/` : trimmedKey;
		const escapedBucket = bucketName.replace(/"/g, "\\\"");
		const escapedKey = normalizedKey.replace(/"/g, "\\\"");
		const escapedLocalPath = localPath.replace(/"/g, "\\\"");
		const s3Uri = escapedKey ? `s3://${escapedBucket}/${escapedKey}` : `s3://${escapedBucket}`;
		const syncCommand = isFolder
			? `runuser -u ubuntu -- /bin/bash -lc "aws s3 sync \"${escapedLocalPath}\" \"${s3Uri}\" --only-show-errors"`
			: `runuser -u ubuntu -- /bin/bash -lc "aws s3 cp \"${escapedLocalPath}\" \"${s3Uri}\" --only-show-errors"`;

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-sync-instance-to-s3",
			resource: null,
			details: { instanceId, localPath, bucketName, destinationKey: normalizedKey, isFolder },
		});

		const commands = [
			"#!/bin/bash",
			"set -e",
			"",
			`echo \"Starting S3 upload from ${escapedLocalPath} to ${s3Uri}\"`,
			syncCommand,
			"echo \"Completed S3 upload\"",
		];

		return this.ssmDao.ExecuteCommand(instanceId, commands);
	}

	/**
	 * Executes SSM commands to sync an S3 object or prefix to an instance path.
	 * For folders, sourceKey is treated as a prefix and localPath is the destination directory.
	 * Uses the instance AWS CLI for batching; set overwriteExisting=false to skip existing files.
	 */
	public async SyncS3ToInstance(params: {
		instanceId: string;
		bucketName: string;
		sourceKey: string;
		localPath: string;
		isFolder?: boolean;
		overwriteExisting?: boolean;
	}): Promise<{ commandId: string }> {
		const { instanceId, bucketName, sourceKey, localPath } = params;
		const isFolder = params.isFolder ?? false;
		const overwriteExisting = params.overwriteExisting ?? true;

		if (!instanceId) {
			throw new Error("instanceId is required");
		}
		if (!bucketName) {
			throw new Error("bucketName is required");
		}
		if (!localPath) {
			throw new Error("localPath is required");
		}
		if (!sourceKey && !isFolder) {
			throw new Error("sourceKey is required for file sync");
		}

		const trimmedKey = sourceKey.replace(/^\/+/, "");
		const normalizedKey = isFolder && trimmedKey && !trimmedKey.endsWith("/") ? `${trimmedKey}/` : trimmedKey;
		const escapedBucket = bucketName.replace(/"/g, "\\\"");
		const escapedKey = normalizedKey.replace(/"/g, "\\\"");
		const escapedLocalPath = localPath.replace(/"/g, "\\\"");

		const commands = [
			"#!/bin/bash",
			"set -e",
			"",
			`echo \"Starting S3 sync from s3://${escapedBucket}/${escapedKey} to ${escapedLocalPath}\"`,
			`BUCKET=\"${escapedBucket}\"`,
			`SOURCE_KEY=\"${escapedKey}\"`,
			`DEST_PATH=\"${escapedLocalPath}\"`,
			`IS_FOLDER=\"${isFolder ? "true" : "false"}\"`,
			`OVERWRITE=\"${overwriteExisting ? "true" : "false"}\"`,
			"",
			"if [ \"$IS_FOLDER\" = \"true\" ]; then",
			"  mkdir -p \"$DEST_PATH\"",
			"  chown ubuntu:ubuntu \"$DEST_PATH\"",
			"  chmod 755 \"$DEST_PATH\"",
			"  if [ \"$OVERWRITE\" = \"true\" ]; then",
			"    aws s3 sync \"s3://$BUCKET/$SOURCE_KEY\" \"$DEST_PATH\" --only-show-errors",
			"    chown -R ubuntu:ubuntu \"$DEST_PATH\"",
			"  else",
			"    aws s3api list-objects-v2 --bucket \"$BUCKET\" --prefix \"$SOURCE_KEY\" --query \"Contents[].Key\" --output text | tr \"\\t\" \"\\n\" | while IFS= read -r key; do",
			"      [ -z \"$key\" ] && continue",
			"      case \"$key\" in */) continue ;; esac",
			"      rel=\"${key#$SOURCE_KEY}\"",
			"      dest=\"$DEST_PATH/$rel\"",
			"      if [ -e \"$dest\" ]; then",
			"        echo \"File exists, skipping: $dest\"",
			"        continue",
			"      fi",
			"      dir=\"$(dirname \"$dest\")\"",
			"      mkdir -p \"$dir\"",
			"      chown ubuntu:ubuntu \"$dir\"",
			"      chmod 755 \"$dir\"",
			"      aws s3 cp \"s3://$BUCKET/$key\" \"$dest\" --only-show-errors",
			"      chown ubuntu:ubuntu \"$dest\"",
			"      chmod 644 \"$dest\"",
			"    done",
			"  fi",
			"else",
			"  dir=\"$(dirname \"$DEST_PATH\")\"",
			"  if [ \"$OVERWRITE\" = \"true\" ] || [ ! -e \"$DEST_PATH\" ]; then",
			"    mkdir -p \"$dir\"",
			"    chown ubuntu:ubuntu \"$dir\"",
			"    chmod 755 \"$dir\"",
			"    aws s3 cp \"s3://$BUCKET/$SOURCE_KEY\" \"$DEST_PATH\" --only-show-errors",
			"    chown ubuntu:ubuntu \"$DEST_PATH\"",
			"    chmod 644 \"$DEST_PATH\"",
			"  else",
			"    echo \"File exists, skipping: $DEST_PATH\"",
			"  fi",
			"fi",
			"echo \"Completed S3 sync\"",
		];

		return this.ssmDao.ExecuteCommand(instanceId, commands);
	}
}
