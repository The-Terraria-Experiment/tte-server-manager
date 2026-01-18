/**
 * Fetch the config file for the server (or the default one if the server doesn't have one uploaded)
 */

const { getS3Object } = require("../shared/utils/aws");
const { FUNC_NAMES } = require("../shared/constants");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { validateResourceAccess } = require("../shared/utils/permissions");
const {successResponse, errorResponse, validationError, notFoundError} = require("../shared/utils/response");

async function handle(event) {
	const serverId = event.pathParameters?.id;

	if (!serverId) {
		return validationError("Server ID is required");
	}

	await validateResourceAccess(event, `server::${serverId}`);

	let isDefaultConfig = false;
	let configFile = await getS3Object(process.env.S3_CONFIG_BUCKET_NAME, `inst#${serverId}/config.json`);

	if (!configFile) {
		configFile = await getS3Object(process.env.S3_CONFIG_BUCKET_NAME, process.env.S3_DEFAULT_CONFIG);
		isDefaultConfig = true;
	}

	if (!configFile) {
		return notFoundError(`Config file for ${serverId}`);
	}

	let parsedFile;
	try {
		parsedFile = JSON.parse(configFile);
	} catch (e) {
		return errorResponse("Failed to parse JSON. Invalid file.");
	}

	logAction(FUNC_NAMES.SERV_MGR, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? 'unknown',
		action: "read-config",
		resource: `${event.httpMethod ?? 'unknown method'}: ${event.path ?? 'unknown path'}`,
		details: { isDefaultConfig }
	});

	return successResponse({
		file: parsedFile,
		isDefaultConfig,
	});
}

module.exports = {handle};
