/**
 * Cognito-Dynamo link Lambda
 * Adds users to Dynamo once they have registered
 * Triggered by Cognito PostConfirmation hook
 */

const {putDynamoItem} = require("./shared/utils/dynamo");
const {PERMISSIONS} = require("./shared/permissionValues");
const { logAction } = require("./shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("./shared/constants");
const { getUserSub } = require("./shared/utils/permissions");

function resolvePermTableFromUserPool(userPoolId) {
	const {
		COGNITO_POOL_ID_PROD,
		COGNITO_POOL_ID_STAGE,
		PERM_TABLE_PROD,
		PERM_TABLE_STAGE,
		PERM_TABLE,
	} = process.env;

	if (!userPoolId) return null;

	if (COGNITO_POOL_ID_PROD && userPoolId === COGNITO_POOL_ID_PROD) {
		return PERM_TABLE_PROD || PERM_TABLE || null;
	}

	if (COGNITO_POOL_ID_STAGE && userPoolId === COGNITO_POOL_ID_STAGE) {
		return PERM_TABLE_STAGE || PERM_TABLE || null;
	}

	return null;
}

exports.handler = async (event, context) => {
	console.log("Cognito User Link - PostConfirmation:", JSON.stringify(event, null, 2));
	const resolvedPermTable = resolvePermTableFromUserPool(event?.userPoolId);

	if (!resolvedPermTable) {
		console.error("Unable to resolve permission table for user pool", {
			userPoolId: event?.userPoolId,
			hasProdPool: Boolean(process.env.COGNITO_POOL_ID_PROD),
			hasStagePool: Boolean(process.env.COGNITO_POOL_ID_STAGE),
			hasProdTable: Boolean(process.env.PERM_TABLE_PROD),
			hasStageTable: Boolean(process.env.PERM_TABLE_STAGE),
			hasFallbackTable: Boolean(process.env.PERM_TABLE),
		});

		logAction(FUNC_NAMES.COG_LINK, {
			userId: getUserSub(event) ?? "unknown",
			action: "route-error",
			resource: event?.userPoolId ?? null,
		});

		// Allow Cognito registration to finish, but do not risk writing to a wrong table.
		return event;
	}

	logAction(FUNC_NAMES.COG_LINK, {
		userId: getUserSub(event) ?? "unknown",
		action: "invoke",
		resource: event?.userPoolId ?? null,
	});

	try {
		// Extract user details from Cognito event
		const {sub, email} = event.request.userAttributes;
		const username = event.userName;

		// Create user record for DynamoDB
		const userRecord = {
			uid: `user#${sub}`,
			sub,
			username,
			displayName: "", // user_xxxx: `User_${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`
			email,
			permissions: [PERMISSIONS.access], // Default role; admins can grant additional roles later,
			resourceAccess: [],
			createdAt: new Date().toISOString(),
			lastLogin: new Date().toISOString(),
		};

		// Write to DynamoDB
		const success = await putDynamoItem(resolvedPermTable, userRecord);

		logAction(FUNC_NAMES.COG_LINK, {
			userId: getUserSub(event) ?? "unknown",
			action: "account-create",
			resource: event?.userPoolId ?? null,
		});

		if (!success) {
			console.error("Failed to create user record in DynamoDB", {
				sub,
				username,
				userPoolId: event?.userPoolId,
				permTable: resolvedPermTable,
			});
			// Don't throw - allow Cognito to complete registration even if Dynamo fails
		} else {
			console.log("User record created successfully", {
				sub,
				username,
				userPoolId: event?.userPoolId,
				permTable: resolvedPermTable,
			});
		}

		// Return event unmodified (required for Cognito triggers)
		return event;
	} catch (error) {
		console.error("Error in PostConfirmation handler:", error);
		// Return event to allow user registration to complete
		// Admin can manually add user to Dynamo if needed
		return event;
	}
};
