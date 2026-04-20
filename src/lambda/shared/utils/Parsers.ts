import type { APIGatewayProxyEvent } from "aws-lambda";

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
}