/**
 * API Gateway Lambda Authorizer
 * Stage-aware Cognito JWT validation
 * Validates tokens against the appropriate Cognito User Pool based on stage
 */

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { logAction } = require('./shared/utils/cloudwatchLogger');
const { FUNC_NAMES } = require('./shared/constants');

// Cognito configuration per stage
const COGNITO_CONFIG = {
	prod: {
		userPoolId: process.env.COGNITO_USER_POOL_ID_PROD,
		clientId: process.env.COGNITO_CLIENT_ID_PROD,
		region: process.env.AWS_REGION || 'us-east-2'
	},
	stage: {
		userPoolId: process.env.COGNITO_USER_POOL_ID_STAGE,
		clientId: process.env.COGNITO_CLIENT_ID_STAGE,
		region: process.env.AWS_REGION || 'us-east-2'
	}
};

// Cache verifiers (warm containers)
const verifiers = {};

/**
 * Get or create a JWT verifier for the specified stage
 */
function getVerifier(stage) {
	if (!verifiers[stage]) {
		const config = COGNITO_CONFIG[stage];
		if (!config || !config.userPoolId) {
			throw new Error(`No Cognito configuration found for stage: ${stage}`);
		}

		verifiers[stage] = CognitoJwtVerifier.create({
			userPoolId: config.userPoolId,
			tokenUse: 'id', // Verify ID tokens
			clientId: config.clientId || null, // Optional: validate client ID
		});

		console.log(`Created verifier for stage: ${stage}, pool: ${config.userPoolId}`);
	}
	return verifiers[stage];
}

/**
 * Extract stage from the method ARN
 * ARN format: arn:aws:execute-api:region:account:apiId/stage/method/resource
 */
function extractStage(methodArn) {
	const parts = methodArn.split('/');
	if (parts.length < 2) {
		throw new Error(`Invalid methodArn format: ${methodArn}`);
	}
	return parts[1]; // 'prod' or 'stage'
}

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(principalId, effect, resource, context = {}) {
	const policy = {
		principalId,
		policyDocument: {
			Version: '2012-10-17',
			Statement: [{
				Action: 'execute-api:Invoke',
				Effect: effect,
				Resource: resource
			}]
		},
		context // Additional context passed to Lambda functions
	};

	return policy;
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
	console.log('Authorizer invoked:', {
		methodArn: event.methodArn,
		authorizationToken: event.authorizationToken ? 'present' : 'missing'
	});

	try {
		// Extract token from Authorization header
		const token = event.authorizationToken;
		if (!token) {
			console.error('No authorization token provided');
			throw new Error('Unauthorized');
		}

		// Remove 'Bearer ' prefix if present
		const jwtToken = token.replace(/^Bearer\s+/i, '');

		// Extract stage from method ARN
		const stage = extractStage(event.methodArn);
		console.log(`Authorizing for stage: ${stage}`);

		// Get appropriate verifier for this stage
		const verifier = getVerifier(stage);

		// Verify the JWT token
		const payload = await verifier.verify(jwtToken);
		console.log('Token verified successfully:', {
			sub: payload.sub,
			email: payload.email
		});

		// Log successful authorization
		logAction(FUNC_NAMES.AUTHORIZER, {
			userId: payload.sub,
			action: 'authorize',
			status: 'allow',
			resource: event.methodArn,
			details: { stage, email: payload.email }
		});

		// Generate Allow policy with user context
		return generatePolicy(
			payload.sub,
			'Allow',
			event.methodArn,
			{
				sub: payload.sub,
				email: payload.email || '',
				// Pass all claims as context (available in Lambda as event.requestContext.authorizer)
				'cognito:username': payload['cognito:username'] || '',
			}
		);

	} catch (error) {
		console.error('Authorization failed:', error.message);

		// Log failed authorization
		logAction(FUNC_NAMES.AUTHORIZER, {
			userId: 'unknown',
			action: 'authorize',
			status: 'deny',
			resource: event.methodArn,
			details: { error: error.message }
		});

		// For security, always return Unauthorized (don't leak error details)
		throw new Error('Unauthorized');
	}
};
