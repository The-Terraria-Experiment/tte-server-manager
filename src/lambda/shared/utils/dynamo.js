/**
 * DynamoDB helper utilities
 * CRUD operations for permissions, users, logs
 */

const {DynamoDBClient} = require("@aws-sdk/client-dynamodb");
const {DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, ScanCommand} = require("@aws-sdk/lib-dynamodb");
const { logError } = require("../middleware/errorHandler");
const { assertIsTruthyString, assertObjectHasTruthyKey, assertSome, assertObjectHasTruthyKeys } = require("../middleware/assert");

const client = new DynamoDBClient({region: process.env.AWS_REGION});
const docClient = DynamoDBDocumentClient.from(client);

/**
 * Get item from DynamoDB
 */
async function getDynamoItem(tableName, key) {
	assertIsTruthyString(tableName, "Table name required for get");
	assertIsTruthyString(key, "Key required for get");
	
	const cmd = new GetCommand({
		TableName: tableName,
		Key: {
			uid: key
		}
	});

	let getCmdResponse;
	try {
		getCmdResponse = await docClient.send(cmd);
	} catch (e) {
		logError(e);
	}

	if (getCmdResponse && getCmdResponse.Item) {
		return getCmdResponse.Item;
	}

	return null;
}

/**
 * Put item to DynamoDB
 */
async function putDynamoItem(tableName, item) {
	assertObjectHasTruthyKey(item, "uid", "'Item' must have a UID value");
	assertIsTruthyString(tableName, "Table name required for put");

	const cmd = new PutCommand({
		TableName: tableName,
		Item: item
	});

	try {
		await docClient.send(cmd);
		return true;
	} catch (e) {
		logError(e);
	}

	return false;
}

/**
 * Query DynamoDB with conditions
 */
async function queryDynamo(tableName, keyCondition, filterExpression) {
	// TODO: Implement QueryCommand
}

/**
 * Update DynamoDB item
 */
async function updateDynamoItem(tableName, key, updateConfig) {
    assertIsTruthyString(tableName, "Table name required for update");
	assertIsTruthyString(key, "Key is required for update");
	assertSome([
		() => assertObjectHasTruthyKey(updateConfig, "updates"),
		() => assertObjectHasTruthyKeys(updateConfig, ["UpdateExpression", "ExpressionAttributeNames", "ExpressionAttributeValues"])
	], "UpdateConfig requires either 'updates' key or 'UpdateExpression', 'ExpressionAttributeNames', and 'ExpressionAttributeValues'");

    let updateExpression;
    let expressionAttributeNames;
    let expressionAttributeValues;

    // If raw expressions provided, use them directly (for complex updates)
    if (updateConfig.UpdateExpression) {
        updateExpression = updateConfig.UpdateExpression;
        expressionAttributeNames = updateConfig.ExpressionAttributeNames;
        expressionAttributeValues = updateConfig.ExpressionAttributeValues;
    } 
    // Otherwise, auto-generate from simple updates object
    else if (updateConfig.updates) {
        const {expression, names, values} = buildUpdateExpression(updateConfig.updates);
        updateExpression = expression;
        expressionAttributeNames = names;
        expressionAttributeValues = values;
    } else {
        throw new Error("Must provide either 'updates' object or 'UpdateExpression'");
    }

	const params = {
		TableName: tableName,
		Key: { 'uid': key },
        UpdateExpression: updateExpression,
        ReturnValues: updateConfig.ReturnValues || "ALL_NEW"
    };

    if (expressionAttributeNames) params.ExpressionAttributeNames = expressionAttributeNames;
    if (expressionAttributeValues) params.ExpressionAttributeValues = expressionAttributeValues;
    if (updateConfig.ConditionExpression) params.ConditionExpression = updateConfig.ConditionExpression;

    const cmd = new UpdateCommand(params);

    try {
        const response = await docClient.send(cmd);
        return response.Attributes;
    } catch (e) {
        logError(e);
        return null;
    }
}

// Helper to auto-generate expressions from simple object
function buildUpdateExpression(updates) {
    const setExpressions = [];
    const names = {};
    const values = {};
    
    Object.entries(updates).forEach(([key, value], index) => {
        const nameKey = `#attr${index}`;
        const valueKey = `:val${index}`;
        
        names[nameKey] = key;
        values[valueKey] = value;
        setExpressions.push(`${nameKey} = ${valueKey}`);
    });

    return {
        expression: `SET ${setExpressions.join(', ')}`,
        names,
        values
    };
}

/**
 * Scan entire DynamoDB table
 * @param {string} tableName
 * @returns {Promise<Array>} All items in the table
 */
async function scanDynamoTable(tableName) {
	assertIsTruthyString(tableName, "Table name required for scan");

	const cmd = new ScanCommand({
		TableName: tableName
	});

	try {
		const response = await docClient.send(cmd);
		return response.Items || [];
	} catch (e) {
		logError(e);
		return [];
	}
}

module.exports = {
	docClient,
	getDynamoItem,
	putDynamoItem,
	queryDynamo,
	updateDynamoItem,
	scanDynamoTable,
};
