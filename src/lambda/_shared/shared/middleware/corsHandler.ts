import type { APIGatewayProxyResult, Context } from "aws-lambda";
import { resolveCorsOrigin } from "../utils/APIResponse.js";
import type { LambdaHandler } from "../../../../shared/types/LambdaTypes.js";

export function corsHandler<TEvent = unknown>(handler: LambdaHandler<TEvent>): LambdaHandler<TEvent> {
	return async (event: TEvent, context: Context): Promise<APIGatewayProxyResult> => {
		const headers = (event as { headers?: Record<string, string | undefined> })?.headers;
		const requestOrigin = headers?.origin ?? headers?.Origin;

		const result = await handler(event, context);

		result.headers = {
			...result.headers,
			"Access-Control-Allow-Origin": resolveCorsOrigin(requestOrigin),
		};
		return result;
	};
}
