import { S3Dao } from "../../aws/S3.js";
import { SsmDao } from "../../aws/SSM.js";
import { Assert } from "../core/Assert.js";
import { TML_LAYOUT, setServerConfigValues, tmlConfigS3Key } from "./TModLoaderLayout.js";
import { tmlBoxPath } from "./TModLoaderLaunch.js";

/**
 * Writes a server password into the instance's tshock/config.json before a world is launched or
 * created. TShock has no working command-line password switch — the only thing that populates
 * Netplay.ServerPassword under TShock is the interactive prompt — so config.json's
 * `Settings.ServerPassword` is the only reliable way to set/override the join password at launch.
 *
 * We read the current config from S3 (the app's source of truth), patch only that one field so every
 * other setting is preserved, push it back to S3, sync it down to the instance, and wait for the sync
 * to finish so the file is in place before TShock reads it.
 *
 * Only call this with a non-empty password; a blank field should leave whatever password the config
 * already has untouched. Assumes the instance is already running with SSM ready.
 */
export const applyServerPasswordToConfig = async (instanceID: string, password: string): Promise<void> => {
	const bucket = process.env.S3_CONFIG_BUCKET_NAME;
	const baseLocalPath = process.env.TSHOCK_WD;
	Assert.IsTruthyString(bucket, "S3 bucket config missing (S3_CONFIG_BUCKET_NAME not set)");
	Assert.IsTruthyString(baseLocalPath, "TShock working directory missing (TSHOCK_WD not set)");

	const S3 = new S3Dao();
	const s3Key = `inst#${instanceID}/config.json`;

	let raw = await S3.GetObject(bucket!, s3Key);
	if (!raw && process.env.S3_DEFAULT_CONFIG) {
		raw = await S3.GetObject(bucket!, process.env.S3_DEFAULT_CONFIG);
	}
	if (!raw) {
		throw new Error("No TShock config file found to apply the server password to");
	}

	let config: Record<string, any>;
	try {
		config = JSON.parse(raw);
	} catch {
		throw new Error("Stored TShock config is not valid JSON");
	}

	// TShock 4.4+ nests settings under "Settings"; fall back to a flat shape defensively.
	if (config.Settings && typeof config.Settings === "object") {
		config.Settings.ServerPassword = password;
	} else {
		config.ServerPassword = password;
	}

	await S3.PutJsonObject(bucket!, s3Key, config, 2);

	const localPath = `${baseLocalPath!.replace(/\/$/, "")}/tshock/config.json`;
	const { commandId } = await S3.SyncS3ToInstance({
		instanceId: instanceID,
		bucketName: bucket!,
		sourceKey: s3Key,
		localPath,
		isFolder: false,
		overwriteExisting: true,
	});

	const SSM = new SsmDao();
	await SSM.PollForCommandCompletion(commandId, instanceID);
};

/**
 * The tModLoader counterpart of {@link applyServerPasswordToConfig}: sets `key=value` lines in the
 * instance's `serverconfig.txt` (S3 is the source of truth, `inst#<id>/serverconfig.txt`), then syncs
 * it down and waits, so the file is in place before the server reads it at launch.
 *
 * Used for the password and, for worldgen, `difficulty` — which tModLoader only accepts from the
 * config file. Unlike TShock's config.json there is no default to fall back to: an absent object
 * starts an empty file, since every key has a built-in default and setup.sh seeds the real one.
 * Values must already be validated; nothing here escapes them.
 */
export const applyTModLoaderServerConfig = async (instanceID: string, updates: Record<string, string | number>): Promise<void> => {
	const bucket = process.env.S3_CONFIG_BUCKET_NAME;
	Assert.IsTruthyString(bucket, "S3 bucket config missing (S3_CONFIG_BUCKET_NAME not set)");

	const S3 = new S3Dao();
	const s3Key = tmlConfigS3Key(instanceID);

	const current = (await S3.GetObject(bucket!, s3Key)) || "";
	await S3.PutTextObject(bucket!, s3Key, setServerConfigValues(current, updates));

	const { commandId } = await S3.SyncS3ToInstance({
		instanceId: instanceID,
		bucketName: bucket!,
		sourceKey: s3Key,
		localPath: tmlBoxPath(TML_LAYOUT.configFile),
		isFolder: false,
		overwriteExisting: true,
	});

	await new SsmDao().PollForCommandCompletion(commandId, instanceID);
};
