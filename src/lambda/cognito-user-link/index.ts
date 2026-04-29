/**
 * Cognito-Dynamo link Lambda
 * Adds users to Dynamo once they have registered
 * Triggered by Cognito PostConfirmation hook
 */

import type { Context, PostConfirmationTriggerEvent } from "aws-lambda";
import { DynamoDao } from "./shared/aws/DynamoDB.js";
import { PERMISSIONS } from "./shared/permissionValues.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function getUserSub(event: PostConfirmationTriggerEvent): string | null {
	return event.request.userAttributes?.sub || null;
}

function resolvePermTableFromUserPool(userPoolId?: string | null): string | null {
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

export const handler = async (
	event: PostConfirmationTriggerEvent,
	context: Context,
): Promise<PostConfirmationTriggerEvent> => {
	void context;

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

		await CWLogger.Action(FUNC_NAMES.COG_LINK, {
			userId: getUserSub(event) ?? "unknown",
			action: "route-error",
			resource: event?.userPoolId ?? null,
		});

		// Allow Cognito registration to finish, but do not risk writing to a wrong table.
		return event;
	}

	await CWLogger.Action(FUNC_NAMES.COG_LINK, {
		userId: getUserSub(event) ?? "unknown",
		action: "invoke",
		resource: event?.userPoolId ?? null,
	});

	try {
		// Extract user details from Cognito event
		const { sub, email } = event.request.userAttributes;
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
		const success = await new DynamoDao().PutItem(resolvedPermTable, userRecord);

		await CWLogger.Action(FUNC_NAMES.COG_LINK, {
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
		console.error("Error in PostConfirmation handler:", getErrorMessage(error));
		// Return event to allow user registration to complete
		// Admin can manually add user to Dynamo if needed
		return event;
	}
};
