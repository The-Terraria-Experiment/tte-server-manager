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

/**
 * Emitted by the instance-side sync script when a requested local file does not exist.
 * The skip is intentionally non-fatal for batch syncs; single-file callers can detect it
 * in the SSM command stdout to distinguish "nothing uploaded" from a real upload.
 */
export const MISSING_LOCAL_FILE_MARKER = "Missing local file, skipping";

/**
 * aws-cli `--include`/`--exclude` filters are glob patterns with no escape syntax, so a relative
 * path containing one of these characters cannot be expressed as an exact filter. Those files fall
 * back to a per-file copy rather than risk a pattern that silently over- or under-matches.
 */
const GLOB_METACHARS = /[*?[\]]/;

/** Max `--include` filters per sync invocation, to keep the SSM command payload bounded. */
const SYNC_INCLUDE_BATCH = 150;

/**
 * Instance-side commands run through two shells — the SSM script, then the `bash -lc` login shell we
 * need for ubuntu's AWS credentials — so every value crosses two rounds of quote parsing. Rather than
 * hand-count backslashes across both levels, arguments are single-quoted for the inner shell (where
 * nothing but `'` is special) and the finished command is then escaped once for the outer one. World
 * names come from user input and may legally contain quotes or spaces, and a single mis-escaped path
 * would otherwise break the whole script under `set -e`.
 */
const shellSingleQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** Escapes a fully-formed command so it survives embedding in an outer double-quoted string. */
const escapeForDoubleQuoted = (command: string): string => command.replace(/([\\"$`])/g, "\\$1");

/** Runs a command as ubuntu through a login shell, so the AWS CLI picks up its profile/region. */
const runAsUbuntu = (command: string): string =>
	`runuser -u ubuntu -- /bin/bash -lc "${escapeForDoubleQuoted(command)}"`;

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

		// exactOptionalPropertyTypes makes S3Client's private Client<> generic incompatible with
		// getSignedUrl's parameter type at the type level only; the SDK client itself is fine at runtime.
		return getSignedUrl(this.s3Client as unknown as Parameters<typeof getSignedUrl>[0], command, { expiresIn });
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

		// exactOptionalPropertyTypes makes S3Client's private Client<> generic incompatible with
		// getSignedUrl's parameter type at the type level only; the SDK client itself is fine at runtime.
		return getSignedUrl(this.s3Client as unknown as Parameters<typeof getSignedUrl>[0], command, { expiresIn });
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
	 * Makes the S3 copies of a set of tracked files match the instance, uploading only the ones that
	 * actually changed.
	 *
	 * Prefer this over {@link SyncInstanceFilesToS3} for multi-file syncs. That method issues one
	 * `aws s3 cp` per file, which re-uploads every byte every run and pays a fresh CLI process startup
	 * per file — with a few dozen tracked world files that alone overruns the caller's lambda timeout.
	 * This batches the whole set into `aws s3 sync` calls that compare size/mtime first and skip
	 * unchanged files, so a typical shutdown uploads only the world that was actually played.
	 *
	 * `--exclude "*"` plus an explicit `--include` per tracked path is what keeps this from repeating
	 * the old "sync uploaded everything on disk" bug: the filters restrict it to exactly the paths
	 * passed in. Callers supply paths relative to `baseRoot`, which map 1:1 onto `{instanceId}/{path}`
	 * keys in the bucket.
	 */
	public async SyncTrackedFilesToS3(params: {
		instanceId: string;
		bucketName: string;
		baseRoot: string;
		relativePaths: string[];
	}): Promise<{ commandId: string }> {
		const { instanceId, bucketName, baseRoot, relativePaths } = params;

		if (!instanceId) {
			throw new Error("instanceId is required");
		}
		if (!bucketName) {
			throw new Error("bucketName is required");
		}
		if (!baseRoot) {
			throw new Error("baseRoot is required");
		}
		if (!relativePaths || relativePaths.length === 0) {
			throw new Error("relativePaths is required");
		}

		const trimmedBase = baseRoot.replace(/\/+$/, "");
		const destination = `s3://${bucketName}/${instanceId}/`;

		const filterable = relativePaths.filter((p) => !GLOB_METACHARS.test(p));
		const literal = relativePaths.filter((p) => GLOB_METACHARS.test(p));

		const commands: string[] = [
			"#!/bin/bash",
			"set -e",
			"",
			`echo "Starting incremental S3 sync (${relativePaths.length} tracked file(s))"`,
			"",
		];

		for (let i = 0; i < filterable.length; i += SYNC_INCLUDE_BATCH) {
			const includes = filterable
				.slice(i, i + SYNC_INCLUDE_BATCH)
				.map((p) => `--include ${shellSingleQuote(p)}`)
				.join(" ");

			commands.push(
				runAsUbuntu(
					`aws s3 sync ${shellSingleQuote(trimmedBase)} ${shellSingleQuote(destination)} --exclude '*' ${includes} --only-show-errors`,
				),
			);
		}

		for (const relativePath of literal) {
			const localPath = `${trimmedBase}/${relativePath}`;
			const uri = `s3://${bucketName}/${instanceId}/${relativePath}`;

			commands.push(`if [ -f ${shellSingleQuote(localPath)} ]; then`);
			commands.push(`  ${runAsUbuntu(`aws s3 cp ${shellSingleQuote(localPath)} ${shellSingleQuote(uri)} --only-show-errors`)}`);
			commands.push("fi");
		}

		commands.push("");
		commands.push("echo \"Completed incremental S3 sync\"");

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-sync-tracked-files-to-s3",
			resource: null,
			details: {
				instanceId,
				bucketName,
				fileCount: relativePaths.length,
				syncBatches: Math.ceil(filterable.length / SYNC_INCLUDE_BATCH),
				literalCopies: literal.length,
			},
		});

		return this.ssmDao.ExecuteCommand(instanceId, commands);
	}

	/**
	 * Executes SSM commands to sync multiple files from an instance to S3, copying each one
	 * unconditionally.
	 *
	 * This is the right call for single-file, refresh-now paths (see {@link SyncInstanceFileToS3}),
	 * where the caller needs the S3 copy rewritten and reads {@link MISSING_LOCAL_FILE_MARKER} out of
	 * stdout. For syncing many files at once, use {@link SyncTrackedFilesToS3} instead.
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
			commands.push(`  echo \"${MISSING_LOCAL_FILE_MARKER}: ${escapedLocalPath}\"`);
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
	 *
	 * Every `aws` call goes through `run_aws` (i.e. {@link runAsUbuntu}) rather than running as the
	 * root user the SSM script starts as, and that is a correctness requirement, not tidiness. When an
	 * instance registers with SSM through Default Host Management Configuration, the agent exports
	 * `AWS_SHARED_CREDENTIALS_FILE=/var/lib/amazon/ssm/credentials` into the command environment, which
	 * outranks IMDS in the CLI's credential chain — so root gets
	 * `AWSSystemsManagerDefaultEC2InstanceManagementRole` (SSM's own managed policy, no access to our
	 * buckets) instead of the instance profile. `runuser` resets the environment, dropping that
	 * variable, so the CLI falls back to IMDS and the instance role. Every other instance-side CLI call
	 * in this file already did this; this one didn't, which is exactly why it was the one that broke.
	 *
	 * The agent drops the DHMC registration once it notices the instance profile, so the window is a
	 * few minutes after boot rather than permanent — which makes it worse, not better: it reproduces
	 * only on a freshly started box and clears itself before anyone finishes investigating.
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
			"set -euo pipefail",
			"",
			// See the docstring: root's AWS CLI can silently be the DHMC role, so hand every call to ubuntu.
			"run_aws() { runuser -u ubuntu -- /bin/bash -lc 'aws \"$@\"' aws \"$@\"; }",
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
			"    run_aws s3 sync \"s3://$BUCKET/$SOURCE_KEY\" \"$DEST_PATH\" --only-show-errors",
			"    chown -R ubuntu:ubuntu \"$DEST_PATH\"",
			"    echo \"Completed S3 sync\"",
			"  else",
			// Captured into a variable, not piped into the loop. As a pipeline head its failure was
			// exempt from `set -e` (no pipefail), so an AccessDenied here produced an empty key list,
			// a loop that ran zero times, "Completed S3 sync", and SSM exit 0 -- a total no-op
			// reported as success. It also ran the loop body in a subshell, so the counters below
			// could not have survived it.
			"    keys=$(run_aws s3api list-objects-v2 --bucket \"$BUCKET\" --prefix \"$SOURCE_KEY\" --query \"Contents[].Key\" --output text)",
			// --output text prints the literal string "None" for an empty result, which would
			// otherwise be treated as a key and attempted as a download.
			"    if [ \"$keys\" = \"None\" ]; then keys=\"\"; fi",
			"    copied=0",
			"    skipped=0",
			// Tabs to newlines via parameter expansion rather than `tr`, to keep the pipeline gone.
			"    while IFS= read -r key; do",
			"      if [ -z \"$key\" ]; then continue; fi",
			"      case \"$key\" in */) continue ;; esac",
			"      rel=\"${key#$SOURCE_KEY}\"",
			"      dest=\"$DEST_PATH/$rel\"",
			"      if [ -e \"$dest\" ]; then",
			"        skipped=$((skipped + 1))",
			"        continue",
			"      fi",
			"      dir=\"$(dirname \"$dest\")\"",
			"      mkdir -p \"$dir\"",
			"      chown ubuntu:ubuntu \"$dir\"",
			"      chmod 755 \"$dir\"",
			"      run_aws s3 cp \"s3://$BUCKET/$key\" \"$dest\" --only-show-errors",
			"      chown ubuntu:ubuntu \"$dest\"",
			"      chmod 644 \"$dest\"",
			"      copied=$((copied + 1))",
			"    done <<< \"${keys//$'\\t'/$'\\n'}\"",
			"    echo \"Completed S3 sync: downloaded $copied file(s), skipped $skipped already present\"",
			"  fi",
			"else",
			"  dir=\"$(dirname \"$DEST_PATH\")\"",
			"  if [ \"$OVERWRITE\" = \"true\" ] || [ ! -e \"$DEST_PATH\" ]; then",
			"    mkdir -p \"$dir\"",
			"    chown ubuntu:ubuntu \"$dir\"",
			"    chmod 755 \"$dir\"",
			"    run_aws s3 cp \"s3://$BUCKET/$SOURCE_KEY\" \"$DEST_PATH\" --only-show-errors",
			"    chown ubuntu:ubuntu \"$DEST_PATH\"",
			"    chmod 644 \"$DEST_PATH\"",
			"    echo \"Completed S3 sync: downloaded 1 file\"",
			"  else",
			"    echo \"Completed S3 sync: file exists, skipped $DEST_PATH\"",
			"  fi",
			"fi",
		];

		return this.ssmDao.ExecuteCommand(instanceId, commands);
	}
}
