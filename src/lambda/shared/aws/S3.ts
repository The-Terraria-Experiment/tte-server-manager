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
	private readonly s3Client: S3Client;
	private readonly ssmDao: SsmDao;

	constructor(region = process.env.AWS_REGION, ssmDao = new SsmDao(region)) {
		this.s3Client = new S3Client({ region: region || "us-east-2" });
		this.ssmDao = ssmDao;
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

	public async GetSignedDownloadUrl(bucketName: string, key: string, expiresIn = 3600): Promise<string> {
		const command = new GetObjectCommand({
			Bucket: bucketName,
			Key: key,
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
		if (!instanceId || !filePath || !bucketName || !key) {
			throw new Error("instanceId, filePath, bucketName, and key are required");
		}

		const escapedFilePath = filePath.replace(/"/g, "\\\"");
		const s3Uri = `s3://${bucketName}/${key}`;
		const command = `runuser -u ubuntu -- /bin/bash -lc "aws s3 cp \"${escapedFilePath}\" \"${s3Uri}\" --only-show-errors"`;

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-sync-instance-file-to-s3",
			resource: null,
			details: { instanceId, filePath, bucketName, key },
		});

		return this.ssmDao.ExecuteCommand(instanceId, [command]);
	}
}
