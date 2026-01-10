/**
 * Edit the valid path roots for an instance
 */

const {UpdateCommand} = require("@aws-sdk/lib-dynamodb");
const {successResponse, validationError} = require("../shared/utils/response");
const {updateDynamoItem} = require("../shared/utils/dynamo");
const {docClient} = require("../shared/utils/dynamo");

async function handle(event) {
	const instanceId = event.pathParameters?.id;

	if (!instanceId) {
		return validationError("Instance ID is required");
	}

	const tableName = process.env.INSTANCE_TABLE_NAME;

	if (!tableName) {
		return validationError("INSTANCE_TABLE_NAME environment variable is required");
	}

	let body = event.parsedBody;

	if (!body) {
		try {
			body = JSON.parse(event.body || "{}");
		} catch (err) {
			return validationError("Request body must be valid JSON");
		}
	}

	const nickname = (body?.nickname || "").trim();
	const path = (body?.path || "").trim();

	if (!nickname) {
		return validationError("nickname is required");
	}

	if (!path) {
		return validationError("path is required");
	}

	const iid = `inst#${instanceId}`;
	const timestamp = new Date().toISOString();

	const updatedItem = await updateDynamoItem(tableName, iid, {
		UpdateExpression: "SET #validRoots.#nickname = :path, updatedAt = :updatedAt",
		ExpressionAttributeNames: {
			"#validRoots": "validRoots",
			"#nickname": nickname,
		},
		ExpressionAttributeValues: {
			":path": path,
			":updatedAt": timestamp,
		},
		ReturnValues: "ALL_NEW",
	}, "iid");

	const updatedRoots = updatedItem?.validRoots || {[nickname]: path};

	return successResponse({
		instanceId,
		nickname,
		path,
		validRoots: updatedRoots,
		updatedAt: updatedItem?.updatedAt || timestamp,
	});
}

module.exports = {handle};
