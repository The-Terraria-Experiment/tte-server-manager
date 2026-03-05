/**
 * Cognito-Dynamo link Lambda
 * Adds users to Dynamo once they have registered
 * Triggered by Cognito PostConfirmation hook
 */

const {putDynamoItem} = require("./shared/utils/dynamo");
const {PERMISSIONS} = require("./shared/permissionValues");
const { logAction } = require("./shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("./shared/constants");

exports.handler = async (event, context) => {
	console.log("Cognito User Link - PostConfirmation:", JSON.stringify(event, null, 2));
	logAction(FUNC_NAMES.COG_LINK, {
		userId: event.requestContext?.authorizer?.claims?.sub ?? "unknown",
		action: "invoke",
		resource: null,
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
		const success = await putDynamoItem(process.env.PERM_TABLE, userRecord);

		logAction(FUNC_NAMES.COG_LINK, {
			userId: event.requestContext?.authorizer?.claims?.sub ?? "unknown",
			action: "account-create",
			resource: null,
		});

		if (!success) {
			console.error("Failed to create user record in DynamoDB", {sub, username});
			// Don't throw - allow Cognito to complete registration even if Dynamo fails
		} else {
			console.log("User record created successfully", {sub, username});
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
