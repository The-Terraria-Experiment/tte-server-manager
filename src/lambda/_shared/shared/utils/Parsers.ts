import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import type { LambdaHandler } from "../../../../shared/types/LambdaTypes.js";
import { logError } from "../middleware/errorHandler.js";
import type { AuthorizedEvent } from "../../../../shared/types/APIGatewayTypes.js";

export class Parsers {
	/**
	 * Extract user sub from API Gateway event
	 * Handles both Cognito authorizer and Lambda authorizer formats:
	 * - Cognito: event.requestContext.authorizer.claims.sub
	 * - Lambda: event.requestContext.authorizer['claims.sub']
	 * @param event - API Gateway event
	 * @returns User sub or null if not found
	 */
	public static GetUserSub(event: APIGatewayProxyEvent): string | null {
		const authorizer = event.requestContext?.authorizer;
		if (!authorizer) return null;

		// Try Cognito format first (nested object)
		if ((authorizer as any).claims?.sub) {
			return (authorizer as any).claims.sub;
		}

		// Try Lambda authorizer format (flat with dot notation)
		if ((authorizer as any)["claims.sub"]) {
			return (authorizer as any)["claims.sub"];
		}

		return null;
	}

	public static InsertParsedBody(handler: LambdaHandler<AuthorizedEvent>) : LambdaHandler<AuthorizedEvent>
	{
		return async (event: AuthorizedEvent, context: Context): Promise<APIGatewayProxyResult> => {
			try {
				if (event.body) {
					event.parsedBody = JSON.parse(event.body);
				}
				return await handler(event, context);
			} catch (error) {
				return logError(error, event);
			}
		};
	}

	public static Truncate(value: string, maxLen: number = 300): string
	{
		if (value.length <= maxLen) {
			return value;
		}
		return `${value.slice(0, maxLen)}...`;
	}
}