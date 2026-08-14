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
import { Assert } from "../utils/core/Assert.js";
import { CW_LOG_GENERAL } from "../constants.js";

/**
 * An item key. A bare `string` is shorthand for `{ uid: <string> }` — every table in this project
 * uses a single `uid` partition key, so that is the overwhelmingly common case and stays the
 * default. Pass a full attribute map for a table or index whose key is anything else.
 */
export type ItemKey = string | Record<string, unknown>;

export interface UpdateConfig {
	updates?: Record<string, unknown>;
	UpdateExpression?: string;
	ExpressionAttributeNames?: Record<string, string>;
	ExpressionAttributeValues?: Record<string, unknown>;
	ConditionExpression?: string;
	ReturnValues?: "NONE" | "ALL_OLD" | "UPDATED_OLD" | "ALL_NEW" | "UPDATED_NEW";
}

export interface QueryConfig {
	keyCondition: string;
	filterExpression?: string;
	expressionAttributeNames?: Record<string, string>;
	expressionAttributeValues?: Record<string, unknown>;
	indexName?: string;
	limit?: number;
	exclusiveStartKey?: Record<string, unknown>;
	scanIndexForward?: boolean;
}

export interface QueryResult {
	items: Record<string, unknown>[];
	lastKey: Record<string, unknown> | null;
}

export interface ScanConfig {
	/** Return only items whose key attribute (see `attribute`) begins with this string. */
	prefix?: string;
	/** Attribute the `prefix` filter applies to. Defaults to `uid`. */
	attribute?: string;
}

export class DynamoDao {
	private static instance: DynamoDao | null = null;
	private readonly docClient!: DynamoDBDocumentClient;

	constructor(region = process.env.AWS_REGION) {
		if (DynamoDao.instance) {
			return DynamoDao.instance;
		}

		const client = new DynamoDBClient({ region: region || "us-east-2" });
		this.docClient = DynamoDBDocumentClient.from(client, {
			marshallOptions: {
				// Drop undefined attribute values rather than throwing during marshalling.
				// Without this, any item containing an undefined field fails the write.
				removeUndefinedValues: true,
			},
		});
		DynamoDao.instance = this;
	}

	public async GetItem(tableName: string, key: ItemKey): Promise<Record<string, unknown> | null> {
		Assert.IsTruthyString(tableName, "Table name required for get");
		DynamoDao.AssertKey(key, "Key required for get");

		const cmd = new GetCommand({
			TableName: tableName,
			Key: DynamoDao.ToKey(key),
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

	public async DeleteItem(tableName: string, key: ItemKey): Promise<boolean>
	{
		Assert.IsTruthyString(tableName, "Table name required for delete");
		DynamoDao.AssertKey(key, "Key required for delete");

		const cmd = new DeleteCommand({
			TableName: tableName,
			Key: DynamoDao.ToKey(key)
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

	public async Query(tableName: string, config: QueryConfig): Promise<QueryResult> {
		Assert.IsTruthyString(tableName, "Table name required for query");
		Assert.IsTruthyString(config.keyCondition, "Key condition required for query");

		const cmd = new QueryCommand({
			TableName: tableName,
			KeyConditionExpression: config.keyCondition,
			...(config.filterExpression ? { FilterExpression: config.filterExpression } : {}),
			...(config.expressionAttributeNames
				? { ExpressionAttributeNames: config.expressionAttributeNames }
				: {}),
			...(config.expressionAttributeValues
				? { ExpressionAttributeValues: config.expressionAttributeValues }
				: {}),
			...(config.indexName ? { IndexName: config.indexName } : {}),
			...(config.limit ? { Limit: config.limit } : {}),
			...(config.exclusiveStartKey ? { ExclusiveStartKey: config.exclusiveStartKey } : {}),
			...(typeof config.scanIndexForward === "boolean"
				? { ScanIndexForward: config.scanIndexForward }
				: {}),
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-dynamo-query",
			resource: null,
			details: {
				tableName,
				keyCondition: config.keyCondition,
				filterExpression: config.filterExpression,
				indexName: config.indexName,
				limit: config.limit,
			},
		});

		try {
			const response = await this.docClient.send(cmd);
			return {
				items: (response.Items as Record<string, unknown>[]) || [],
				lastKey: (response.LastEvaluatedKey as Record<string, unknown>) || null,
			};
		} catch (error) {
			CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "query", tableName },
			});
			return { items: [], lastKey: null };
		}
	}

	public async UpdateItem(
		tableName: string,
		key: ItemKey,
		updateConfig: UpdateConfig,
	): Promise<Record<string, unknown> | null> {
		Assert.IsTruthyString(tableName, "Table name required for update");
		DynamoDao.AssertKey(key, "Key is required for update");
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
			Key: Record<string, unknown>;
			UpdateExpression: string;
			ReturnValues: NonNullable<UpdateConfig["ReturnValues"]>;
			ExpressionAttributeNames?: Record<string, string>;
			ExpressionAttributeValues?: Record<string, unknown>;
			ConditionExpression?: string;
		} = {
			TableName: tableName,
			Key: DynamoDao.ToKey(key),
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

	/**
	 * Scans a whole table, following `LastEvaluatedKey` to completion. A single ScanCommand caps out
	 * at 1MB of items and silently returns a partial result, so paginating is a correctness
	 * requirement rather than an optimisation — a truncated scan looks exactly like a table that has
	 * fewer rows than it does.
	 *
	 * @param tableName - Table to scan
	 * @param config - Optional `prefix` to return only items whose key attribute (`uid` by default,
	 *   or `config.attribute`) begins with it. Applied as a Dynamo FilterExpression, which runs
	 *   *after* the read — it trims the payload, not the RCUs. These tables mix record types under
	 *   one bare `uid` partition key, so `begins_with` on a Query of the table itself is not an
	 *   alternative; a GSI over a record-type attribute is (see `QueryConfig.indexName`), and is the
	 *   right move for any record family read often enough for the RCUs to matter.
	 */
	public async ScanTable(tableName: string, config: ScanConfig = {}): Promise<Record<string, unknown>[]> {
		Assert.IsTruthyString(tableName, "Table name required for scan");

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-dynamo-scan-table",
			resource: null,
			details: { tableName, prefix: config.prefix ?? null, attribute: config.attribute ?? null },
		});

		const items: Record<string, unknown>[] = [];
		let exclusiveStartKey: Record<string, unknown> | undefined = undefined;

		const prefixFilter = config.prefix
			? {
					FilterExpression: "begins_with(#pfxattr, :prefix)",
					ExpressionAttributeNames: { "#pfxattr": config.attribute || "uid" },
					ExpressionAttributeValues: { ":prefix": config.prefix },
				}
			: {};

		try {
			do {
				const cmd: ScanCommand = new ScanCommand({
					TableName: tableName,
					...prefixFilter,
					...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
				});

				const response = await this.docClient.send(cmd);
				items.push(...((response.Items as Record<string, unknown>[]) || []));
				exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
			} while (exclusiveStartKey);

			return items;
		} catch (error) {
			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "scanTable", tableName },
			});
			return [];
		}
	}

	/** Expands the `string` shorthand into the default single-attribute `uid` key. */
	private static ToKey(key: ItemKey): Record<string, unknown> {
		return typeof key === "string" ? { uid: key } : key;
	}

	/**
	 * Accepts either form of `ItemKey`. Kept as an assertion rather than letting Dynamo reject it,
	 * because an empty key otherwise surfaces as a validation error from the SDK with no indication
	 * of which of our call sites produced it.
	 */
	private static AssertKey(key: ItemKey, failMessage: string): void {
		Assert.Some(
			[
				() => Assert.IsTruthyString(key, failMessage),
				() => {
					Assert.IsTruthy(key && typeof key === "object", failMessage);
					Assert.IsTruthy(Object.keys(key as Record<string, unknown>).length > 0, failMessage);
				},
			],
			failMessage,
		);
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
