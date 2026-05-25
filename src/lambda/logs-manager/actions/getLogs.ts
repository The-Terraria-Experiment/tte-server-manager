import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { PlayerEvent, ServerEvent } from "../shared/schema/LogsTable.js";
import { LOGS_TABLE } from "../shared/vars.js";

export const getLogs = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const serverID = event.pathParameters?.id;

	if (!serverID) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	if (
		event.parsedBody?.eventType !== undefined &&
		event.parsedBody?.eventType !== null &&
		!Object.values(PlayerEvent).includes(event.parsedBody?.eventType) &&
		!Object.values(ServerEvent).includes(event.parsedBody?.eventType)
	) {
		return ResponseUtil.ValidationError("Invalid event type");
	}

	if (event.parsedBody?.eventTypes !== undefined && event.parsedBody?.eventTypes !== null) {
		if (!Array.isArray(event.parsedBody.eventTypes) || event.parsedBody.eventTypes.length === 0) {
			return ResponseUtil.ValidationError("Invalid event types");
		}

		const hasInvalidEvent = event.parsedBody.eventTypes.some((eventType: unknown) =>
			!Object.values(PlayerEvent).includes(eventType as PlayerEvent) &&
			!Object.values(ServerEvent).includes(eventType as ServerEvent)
		);
		if (hasInvalidEvent) {
			return ResponseUtil.ValidationError("Invalid event types");
		}
	}

	if (typeof event.parsedBody?.startTime !== "number" && event.parsedBody?.startTime !== null) {
		return ResponseUtil.ValidationError("Invalid start time");
	}
	if (typeof event.parsedBody?.endTime !== "number" && event.parsedBody?.endTime !== null) {
		return ResponseUtil.ValidationError("Invalid end time");
	}

	if (typeof event.parsedBody?.player !== "string" && event.parsedBody?.player !== null) {
		return ResponseUtil.ValidationError("Invalid player identifier");
	}

	if (event.parsedBody?.lastValue === undefined) {
		return ResponseUtil.ValidationError("Invalid query params");
	}

	if (
		event.parsedBody?.lastValue !== null &&
		typeof event.parsedBody?.lastValue !== "number" &&
		(typeof event.parsedBody?.lastValue !== "object" || Array.isArray(event.parsedBody?.lastValue))
	) {
		return ResponseUtil.ValidationError("Invalid lastValue");
	}

	if (
		typeof event.parsedBody?.startTime === "number" &&
		typeof event.parsedBody?.endTime === "number" &&
		event.parsedBody.startTime > event.parsedBody.endTime
	) {
		return ResponseUtil.ValidationError("Start time must be <= end time");
	}

	const DB = new DynamoDao();
	const serverKey = `server#${serverID}`;
	const eventType = event.parsedBody?.eventType ?? null;
	const eventTypesRaw = event.parsedBody?.eventTypes ?? null;
	const eventTypes = eventTypesRaw ? Array.from(new Set(eventTypesRaw)) : null;
	const playerName = event.parsedBody?.player ?? null;
	const startTime = event.parsedBody?.startTime ?? null;
	const endTime = event.parsedBody?.endTime ?? null;
	const lastValue = event.parsedBody?.lastValue ?? null;

	if (eventType !== null && eventTypes !== null) {
		return ResponseUtil.ValidationError("Specify either eventType or eventTypes, not both");
	}

	if (eventType !== null && playerName !== null) {
		return ResponseUtil.ValidationError("Specify either eventType or player, not both");
	}

	const indexName = eventType !== null ? "event" : playerName !== null ? "player" : undefined;
	const partitionKeyName = eventType !== null ? "eventType" : playerName !== null ? "playerName" : "serverID";
	const partitionKeyValue = eventType !== null ? eventType : playerName !== null ? playerName : serverKey;

	const expressionAttributeNames: Record<string, string> = {
		"#pk": partitionKeyName,
		"#ts": "timestamp",
	};
	const expressionAttributeValues: Record<string, unknown> = {
		":pk": partitionKeyValue,
	};

	const timeConditions: string[] = [];
	if (startTime !== null && endTime !== null) {
		timeConditions.push("#ts BETWEEN :startTime AND :endTime");
		expressionAttributeValues[":startTime"] = startTime;
		expressionAttributeValues[":endTime"] = endTime;
	} else if (startTime !== null) {
		timeConditions.push("#ts >= :startTime");
		expressionAttributeValues[":startTime"] = startTime;
	} else if (endTime !== null) {
		timeConditions.push("#ts <= :endTime");
		expressionAttributeValues[":endTime"] = endTime;
	}

	const keyCondition = timeConditions.length > 0
		? `#pk = :pk AND ${timeConditions.join(" AND ")}`
		: "#pk = :pk";

	const filterParts: string[] = [];
	if (partitionKeyName !== "serverID") {
		expressionAttributeNames["#serverId"] = "serverID";
		expressionAttributeValues[":serverId"] = serverKey;
		filterParts.push("#serverId = :serverId");
	}

	if (eventTypes !== null) {
		expressionAttributeNames["#eventType"] = "eventType";
		const eventTokens = eventTypes.map((value, index) => {
			const token = `:eventType${index}`;
			expressionAttributeValues[token] = value;
			return token;
		});
		filterParts.push(`#eventType IN (${eventTokens.join(", ")})`);
	}

	const filterExpression = filterParts.length > 0 ? filterParts.join(" AND ") : undefined;

	let exclusiveStartKey: Record<string, unknown> | undefined;
	if (lastValue !== null) {
		if (typeof lastValue === "number") {
			exclusiveStartKey = {
				[partitionKeyName]: partitionKeyValue,
				timestamp: lastValue,
				...(partitionKeyName !== "serverID" ? { serverID: serverKey } : {}),
			};
		} else {
			exclusiveStartKey = lastValue as Record<string, unknown>;
		}
	}

	const PAGE_SIZE = 50;
	const entries: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | null = null;
	let remaining = PAGE_SIZE;
	let nextStartKey = exclusiveStartKey;

	while (remaining > 0) {
		const queryConfig = {
			keyCondition,
			limit: remaining,
			scanIndexForward: false,
			expressionAttributeNames,
			expressionAttributeValues,
			...(filterExpression ? { filterExpression } : {}),
			...(indexName ? { indexName } : {}),
			...(nextStartKey ? { exclusiveStartKey: nextStartKey } : {}),
		};

		const result = await DB.Query(LOGS_TABLE, queryConfig);

		entries.push(...result.items);
		lastKey = result.lastKey;
		remaining = PAGE_SIZE - entries.length;
		if (!lastKey) {
			break;
		}
		nextStartKey = lastKey;
	}

	return ResponseUtil.Success({
		entries,
		lastValue: lastKey,
	});
};
