import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { getPublicJwk } from "../lib/signing.js";

export const jwks = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
	void event;
	void context;

	const jwk = await getPublicJwk();
	return ResponseUtil.Success({ keys: [jwk] });
};
