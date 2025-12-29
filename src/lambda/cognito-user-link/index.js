/**
 * Cognito-Dynamo link Lambda
 * Adds users to Dynamo once they have registered
 * Triggered by Cognito PostConfirmation hook
 */

const {putDynamoItem} = require("./shared/utils/dynamo");
const {PERM_TABLE} = require("./shared/constants");
const {PERMISSIONS} = require("../shared/permissionValues");

exports.handler = async (event, context) => {
	console.log("Cognito User Link - PostConfirmation:", JSON.stringify(event, null, 2));

	try {
		// Extract user details from Cognito event
		const {sub, email} = event.request.userAttributes;
		const username = event.userName;

		// Create user record for DynamoDB
		const userRecord = {
			uid: `user#${sub}`,
			sub,
			username,
			email,
			permissions: [PERMISSIONS.access], // Default role; admins can grant additional roles later
			createdAt: new Date().toISOString(),
			lastLogin: new Date().toISOString(),
		};

		// Write to DynamoDB
		const success = await putDynamoItem(PERM_TABLE, userRecord);

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
