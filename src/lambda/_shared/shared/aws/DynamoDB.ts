import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	DeleteCommand,
	DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CWLogger } from "./CloudWatch.js";
import { Assert } from "../utils/Assert.js";
import { CW_LOG_GENERAL } from "../constants.js";

export interface UpdateConfig {
	updates?: Record<string, unknown>;
	UpdateExpression?: string;
	ExpressionAttributeNames?: Record<string, string>;
	ExpressionAttributeValues?: Record<string, unknown>;
	ConditionExpression?: string;
	ReturnValues?: "NONE" | "ALL_OLD" | "UPDATED_OLD" | "ALL_NEW" | "UPDATED_NEW";
}

export class DynamoDao {
	private static instance: DynamoDao | null = null;
	private readonly docClient!: DynamoDBDocumentClient;

	constructor(region = process.env.AWS_REGION) {
		if (DynamoDao.instance) {
			return DynamoDao.instance;
		}

		const client = new DynamoDBClient({ region: region || "us-east-2" });
		this.docClient = DynamoDBDocumentClient.from(client);
		DynamoDao.instance = this;
	}

	public async GetItem(tableName: string, key: string): Promise<Record<string, unknown> | null> {
		Assert.IsTruthyString(tableName, "Table name required for get");
		Assert.IsTruthyString(key, "Key required for get");

		const cmd = new GetCommand({
			TableName: tableName,
			Key: {
				uid: key,
			},
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-dynamo-get-item",
			resource: null,
			details: { tableName, key },
		});

		let response;
		try {
			response = await this.docClient.send(cmd);
		} catch (error) {
			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "getItem", tableName, key },
			});
		}

		return (response?.Item as Record<string, unknown>) || null;
	}

	public async PutItem(tableName: string, item: Record<string, unknown>): Promise<boolean> {
		Assert.IsTruthyString(tableName, "Table name required for put");

		const cmd = new PutCommand({
			TableName: tableName,
			Item: item,
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-dynamo-put-item",
			resource: null,
			details: { tableName, item },
		});

		try {
			await this.docClient.send(cmd);
			return true;
		} catch (error) {
			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "putItem", tableName },
			});
		}

		return false;
	}

	public async DeleteItem(tableName: string, key: string): Promise<boolean>
	{
		Assert.IsTruthyString(tableName, "Table name required for delete");
		Assert.IsTruthyString(key, "Key required for delete");

		const cmd = new DeleteCommand({
			TableName: tableName,
			Key: {
				uid: key
			}
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-dynamo-delete-item",
			resource: null,
			details: { tableName, key },
		});

		try {
			await this.docClient.send(cmd);
			return true;
		} catch (error) {
			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "deleteItem", tableName, key },
			});
			return false;
		}
	}

	public async Query(
		tableName: string,
		keyCondition: string,
		filterExpression?: string,
	): Promise<Record<string, unknown>[]> {
		Assert.IsTruthyString(tableName, "Table name required for query");
		Assert.IsTruthyString(keyCondition, "Key condition required for query");

		const cmd = new QueryCommand({
			TableName: tableName,
			KeyConditionExpression: keyCondition,
			...(filterExpression ? { FilterExpression: filterExpression } : {}),
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-dynamo-query",
			resource: null,
			details: { tableName, keyCondition, filterExpression },
		});

		try {
			const response = await this.docClient.send(cmd);
			return (response.Items as Record<string, unknown>[]) || [];
		} catch (error) {
			CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "query", tableName },
			});
			return [];
		}
	}

	public async UpdateItem(
		tableName: string,
		key: string,
		updateConfig: UpdateConfig,
	): Promise<Record<string, unknown> | null> {
		Assert.IsTruthyString(tableName, "Table name required for update");
		Assert.IsTruthyString(key, "Key is required for update");
		Assert.Some(
			[
				() => Assert.ObjectHasTruthyKey(updateConfig, "updates", "Invalid update config"),
				() =>
					Assert.ObjectHasTruthyKeys(
						updateConfig,
						["UpdateExpression", "ExpressionAttributeNames", "ExpressionAttributeValues"],
						"Invalid update config",
					),
			],
			"UpdateConfig requires either 'updates' key or 'UpdateExpression', 'ExpressionAttributeNames', and 'ExpressionAttributeValues'",
		);

		let updateExpression: string;
		let expressionAttributeNames: Record<string, string> | undefined;
		let expressionAttributeValues: Record<string, unknown> | undefined;

		if (updateConfig.UpdateExpression) {
			updateExpression = updateConfig.UpdateExpression;
			expressionAttributeNames = updateConfig.ExpressionAttributeNames;
			expressionAttributeValues = updateConfig.ExpressionAttributeValues;
		} else if (updateConfig.updates) {
			const generated = DynamoDao.BuildUpdateExpression(updateConfig.updates);
			updateExpression = generated.expression;
			expressionAttributeNames = generated.names;
			expressionAttributeValues = generated.values;
		} else {
			throw new Error("Must provide either 'updates' object or 'UpdateExpression'");
		}

		const params: {
			TableName: string;
			Key: { uid: string };
			UpdateExpression: string;
			ReturnValues: NonNullable<UpdateConfig["ReturnValues"]>;
			ExpressionAttributeNames?: Record<string, string>;
			ExpressionAttributeValues?: Record<string, unknown>;
			ConditionExpression?: string;
		} = {
			TableName: tableName,
			Key: { uid: key },
			UpdateExpression: updateExpression,
			ReturnValues: updateConfig.ReturnValues || "ALL_NEW",
		};

		if (expressionAttributeNames) {
			params.ExpressionAttributeNames = expressionAttributeNames;
		}
		if (expressionAttributeValues) {
			params.ExpressionAttributeValues = expressionAttributeValues;
		}
		if (updateConfig.ConditionExpression) {
			params.ConditionExpression = updateConfig.ConditionExpression;
		}

		const cmd = new UpdateCommand(params);

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-dynamo-update-item",
			resource: null,
			details: { tableName, key, updateConfig },
		});

		try {
			const response = await this.docClient.send(cmd);
			return (response.Attributes as Record<string, unknown>) || null;
		} catch (error) {
			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "updateItem", tableName, key },
			});
			return null;
		}
	}

	public async ScanTable(tableName: string): Promise<Record<string, unknown>[]> {
		Assert.IsTruthyString(tableName, "Table name required for scan");

		const cmd = new ScanCommand({
			TableName: tableName,
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-dynamo-scan-table",
			resource: null,
			details: { tableName },
		});

		try {
			const response = await this.docClient.send(cmd);
			return (response.Items as Record<string, unknown>[]) || [];
		} catch (error) {
			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "scanTable", tableName },
			});
			return [];
		}
	}

	private static BuildUpdateExpression(updates: Record<string, unknown>): {
		expression: string;
		names: Record<string, string>;
		values: Record<string, unknown>;
	} {
		const setExpressions: string[] = [];
		const names: Record<string, string> = {};
		const values: Record<string, unknown> = {};

		Object.entries(updates).forEach(([key, value], index) => {
			const nameKey = `#attr${index}`;
			const valueKey = `:val${index}`;

			names[nameKey] = key;
			values[valueKey] = value;
			setExpressions.push(`${nameKey} = ${valueKey}`);
		});

		return {
			expression: `SET ${setExpressions.join(", ")}`,
			names,
			values,
		};
	}
}
