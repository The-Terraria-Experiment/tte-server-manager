import type { APIGatewayProxyResult, Context } from "aws-lambda"
import type { PermissionValue } from "../../lambda/_shared/shared/permissionValues.js"
import type { AuthorizedEvent } from "./APIGatewayTypes.js";

export type LambdaHandler<TEvent = unknown> = (
	event: TEvent,
	context: Context,
) => Promise<APIGatewayProxyResult>;

export type EndpointList = {
	[key: string]: {
		action: ((event: AuthorizedEvent, context: Context) => Promise<APIGatewayProxyResult> | APIGatewayProxyResult) | null,
		permRequired: PermissionValue
	}
}
