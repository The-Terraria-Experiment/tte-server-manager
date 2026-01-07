/**
 * Upload files to s3 and then write them to the appropriate instance 
 */

const {s3Client} = require("../shared/utils/aws");
const {PutObjectCommand} = require("@aws-sdk/client-s3");
const {successResponse, validationError} = require("../shared/utils/response");
const AdmZip = require("adm-zip");
const Busboy = require("busboy");

async function handle(event) {
	const instanceId = event.pathParameters?.id;
	const bucketName = process.env.S3_FILESTORE_NAME;
	const allowedPaths = JSON.parse(process.env.VALID_PATH_ROOTS || "[]");

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	if (!bucketName) {
		return validationError("S3 bucket not configured");
	}

	// Parse request body for pathRoot, path, and zip file
	let pathRoot, path, zipBuffer;
	
	if (event.isBase64Encoded && event.headers["content-type"]?.includes("multipart/form-data")) {
		// Parse FormData using busboy
		const formData = await parseFormData(event);
		zipBuffer = formData.file;
		pathRoot = formData.pathRoot;
		path = formData.path || ""; // Optional subdirectory path within pathRoot
	} else if (event.isBase64Encoded) {
		// If body is base64 encoded binary (raw zip file)
		zipBuffer = Buffer.from(event.body, "base64");
		pathRoot = event.queryStringParameters?.pathRoot;
		path = event.queryStringParameters?.path || "";
	} else {
		// If body is JSON with base64 encoded zip
		try {
			const body = JSON.parse(event.body || "{}");
			zipBuffer = Buffer.from(body.zipData, "base64");
			pathRoot = body.pathRoot;
			path = body.path || "";
		} catch (e) {
			return validationError("Invalid request body: must be FormData, zip file, or JSON with zipData");
		}
	}

	if (!pathRoot) {
		return validationError("pathRoot parameter is required");
	}

	// Validate pathRoot against allowed paths
	if (!allowedPaths.includes(pathRoot)) {
		return validationError(`Invalid pathRoot. Allowed paths: ${allowedPaths.join(", ")}`);
	}

	try {
		// Unzip the buffer
		const zip = new AdmZip(zipBuffer);
		const entries = zip.getEntries();

		if (entries.length === 0) {
			return validationError("Zip file is empty");
		}

		// Upload each file to S3
		const uploadedFiles = [];
		const errors = [];

		for (const entry of entries) {
			// Skip directories
			if (entry.isDirectory) continue;

			try {
				// Build S3 path: {instanceID}/{pathRoot}/{path}/{file structure}
				const pathComponents = [instanceId, pathRoot];
				if (path) {
					pathComponents.push(path);
				}
				pathComponents.push(entry.entryName);
				const s3Path = pathComponents.join("/");
				const fileData = entry.getData();

				const command = new PutObjectCommand({
					Bucket: bucketName,
					Key: s3Path,
					Body: fileData,
					ContentType: getContentType(entry.entryName),
				});

				await s3Client.send(command);
				uploadedFiles.push(s3Path);
			} catch (error) {
				errors.push({
					file: entry.entryName,
					error: error.message,
				});
			}
		}

		// Return partial success if some files failed
		const statusCode = errors.length === 0 ? 200 : 207; // 207 Multi-Status
		return successResponse(
			{
				message: "Files uploaded to S3",
				instanceId,
				pathRoot,
				path,
				uploadedFiles,
				errors: errors.length > 0 ? errors : undefined,
				uploadedCount: uploadedFiles.length,
				errorCount: errors.length,
			},
			statusCode
		);
	} catch (error) {
		console.error("Upload error:", error);
		return validationError(`Failed to process zip file: ${error.message}`);
	}
}

/**
 * Parse multipart/form-data from API Gateway event
 * @param {object} event - API Gateway event
 * @returns {Promise<{file: Buffer, pathRoot: string, path: string}>}
 */
function parseFormData(event) {
	return new Promise((resolve, reject) => {
		const contentType = event.headers["content-type"] || event.headers["Content-Type"];
		const busboy = Busboy({headers: {"content-type": contentType}});
		
		const result = {
			file: null,
			pathRoot: null,
			path: null,
		};

		busboy.on("file", (fieldname, file, info) => {
			const chunks = [];
			file.on("data", (chunk) => chunks.push(chunk));
			file.on("end", () => {
				result.file = Buffer.concat(chunks);
			});
		});

		busboy.on("field", (fieldname, value) => {
			if (fieldname === "pathRoot") {
				result.pathRoot = value;
			} else if (fieldname === "path") {
				result.path = value;
			}
		});

		busboy.on("finish", () => {
			if (!result.file) {
				reject(new Error("No file found in FormData"));
			} else {
				resolve(result);
			}
		});

		busboy.on("error", (error) => {
			reject(error);
		});

		// Write the base64 decoded body to busboy
		const bodyBuffer = Buffer.from(event.body, "base64");
		busboy.write(bodyBuffer);
		busboy.end();
	});
}

/**
 * Determine content type based on file extension
 * @param {string} filename
 * @returns {string}
 */
function getContentType(filename) {
	const ext = filename.split(".").pop()?.toLowerCase();
	const types = {
		json: "application/json",
		txt: "text/plain",
		yml: "text/yaml",
		yaml: "text/yaml",
		conf: "text/plain",
		cfg: "text/plain",
		xml: "application/xml",
		zip: "application/zip",
	};
	return types[ext] || "application/octet-stream";
}

module.exports = {handle};
