import type { APIGatewayProxyEvent } from "aws-lambda";

export type CustomAuthorizerContext = {
    "claims.sub"?: string;
    "claims.email"?: string;
    "claims.email_verified"?: string;
    "claims.cognito:username"?: string;
    "claims.aud"?: string;
    "claims.token_use"?: string;
};

export type AuthorizedEvent = APIGatewayProxyEvent & {
    requestContext: APIGatewayProxyEvent["requestContext"] & {
        authorizer?: (APIGatewayProxyEvent["requestContext"]["authorizer"] & CustomAuthorizerContext) | null;
	};
	parsedBody: string | undefined;
};