/**
 * API Gateway Lambda Authorizer
 * Stage-aware Cognito JWT validation
 * Validates tokens against the appropriate Cognito User Pool based on stage
 */

import type { APIGatewayAuthorizerResult, APIGatewayTokenAuthorizerEvent } from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";

type StageName = "prod" | "stage";

type StageConfig = {
	userPoolId: string | undefined;
	clientId: string | undefined;
	region: string;
};

type VerifiedTokenPayload = {
	sub: string;
	email?: string;
	email_verified?: boolean | string;
	aud?: string;
	token_use?: string;
	"cognito:username"?: string;
};

// Cognito configuration per stage
const COGNITO_CONFIG: Record<StageName, StageConfig> = {
	prod: {
		userPoolId: process.env.COGNITO_USER_POOL_ID_PROD,
		clientId: process.env.COGNITO_CLIENT_ID_PROD,
		region: process.env.AWS_REGION || "us-east-2",
	},
	stage: {
		userPoolId: process.env.COGNITO_USER_POOL_ID_STAGE,
		clientId: process.env.COGNITO_CLIENT_ID_STAGE,
		region: process.env.AWS_REGION || "us-east-2",
	},
};

type Verifier = ReturnType<typeof CognitoJwtVerifier.create>;

// Cache verifiers (warm containers)
const verifiers: Partial<Record<StageName, Verifier>> = {};

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

/**
 * Get or create a JWT verifier for the specified stage
 */
function getVerifier(stage: StageName): Verifier {
	if (!verifiers[stage]) {
		const config = COGNITO_CONFIG[stage];
		if (!config || !config.userPoolId) {
			throw new Error(`No Cognito configuration found for stage: ${stage}`);
		}

		verifiers[stage] = CognitoJwtVerifier.create({
			userPoolId: config.userPoolId,
			tokenUse: "id", // Verify ID tokens
			clientId: config.clientId || null, // Optional: validate client ID
		});

		console.log(`Created verifier for stage: ${stage}, pool: ${config.userPoolId}`);
	}

	return verifiers[stage] as Verifier;
}

/**
 * Extract stage from the method ARN
 * ARN format: arn:aws:execute-api:region:account:apiId/stage/method/resource
 */
function extractStage(methodArn: string): StageName {
	const parts = methodArn.split("/");
	if (parts.length < 2) {
		throw new Error(`Invalid methodArn format: ${methodArn}`);
	}

	const stage = parts[1];
	if (stage !== "prod" && stage !== "stage") {
		throw new Error(`Unsupported stage: ${stage}`);
	}

	return stage;
}

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(
	principalId: string,
	effect: "Allow" | "Deny",
	resource: string,
	context: Record<string, string> = {},
): APIGatewayAuthorizerResult {
	return {
		principalId,
		policyDocument: {
			Version: "2012-10-17",
			Statement: [
				{
					Action: "execute-api:Invoke",
					Effect: effect,
					Resource: resource,
				},
			],
		},
		context,
	};
}

/**
 * Lambda handler
 */
export const handler = async (event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
	console.log("Authorizer invoked:", {
		methodArn: event.methodArn,
		authorizationToken: event.authorizationToken ? "present" : "missing",
	});

	try {
		// Extract token from Authorization header
		const token = event.authorizationToken;
		if (!token) {
			console.error("No authorization token provided");
			throw new Error("Unauthorized");
		}

		// Remove 'Bearer ' prefix if present
		const jwtToken = token.replace(/^Bearer\s+/i, "");

		// Extract stage from method ARN
		const stage = extractStage(event.methodArn);
		console.log(`Authorizing for stage: ${stage}`);

		// Get appropriate verifier for this stage
		const verifier = getVerifier(stage);

		// Verify the JWT token
		const payload = (await verifier.verify(jwtToken)) as VerifiedTokenPayload;
		console.log("Token verified successfully:", {
			sub: payload.sub,
			email: payload.email,
		});

		// Log successful authorization
		await CWLogger.Action(FUNC_NAMES.AUTHORIZER, {
			userId: payload.sub,
			action: "authorize",
			status: "allow",
			resource: event.methodArn,
			details: { stage, email: payload.email },
		});

		// Generate Allow policy with user context
		// NOTE: Lambda authorizer context values must be flat strings (no nested objects)
		// We use dot notation keys to simulate Cognito's structure: claims.sub, claims.email, etc.

		// Build wildcard resource ARN - allow all methods in this stage
		// Format: arn:aws:execute-api:region:account:apiId/stage/*/*
		const arnParts = event.methodArn.split("/");
		const apiGatewayArn = arnParts.slice(0, 2).join("/"); // arn:aws:execute-api:region:account:apiId/stage
		const resourceArn = `${apiGatewayArn}/*/*`; // Allow all methods and paths

		return generatePolicy(payload.sub, "Allow", resourceArn, {
			"claims.sub": payload.sub,
			"claims.email": payload.email || "",
			"claims.email_verified": String(payload.email_verified || "false"),
			"claims.cognito:username": payload["cognito:username"] || payload.email || "",
			"claims.aud": payload.aud || "",
			"claims.token_use": payload.token_use || "id",
		});
	} catch (error) {
		const message = getErrorMessage(error);
		console.error("Authorization failed:", message);

		// Log failed authorization
		await CWLogger.Action(FUNC_NAMES.AUTHORIZER, {
			userId: "unknown",
			action: "authorize",
			status: "deny",
			resource: event.methodArn,
			details: { error: message },
		});

		// For security, always return Unauthorized (don't leak error details)
		throw new Error("Unauthorized");
	}
};