import {
	AdminDeleteUserCommand,
	CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { CWLogger } from "./CloudWatch.js";
import { Assert } from "../utils/Assert.js";
import { CW_LOG_GENERAL } from "../constants.js";

export class CognitoDao {
	private static instance: CognitoDao | null = null;
	private readonly client!: CognitoIdentityProviderClient;

	constructor(region = process.env.AWS_REGION) {
		if (CognitoDao.instance) {
			return CognitoDao.instance;
		}

		this.client = new CognitoIdentityProviderClient({ region: region || "us-east-2" });
		CognitoDao.instance = this;
	}

	/**
	 * Delete a user from a Cognito user pool.
	 * A missing user (UserNotFoundException) is treated as success so callers can safely retry.
	 */
	public async AdminDeleteUser(userPoolId: string, username: string): Promise<boolean> {
		Assert.IsTruthyString(userPoolId, "User pool ID required for delete");
		Assert.IsTruthyString(username, "Username required for delete");

		const cmd = new AdminDeleteUserCommand({
			UserPoolId: userPoolId,
			Username: username,
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-cognito-admin-delete-user",
			resource: null,
			details: { userPoolId, username },
		});

		try {
			await this.client.send(cmd);
			return true;
		} catch (error) {
			if (error instanceof Error && error.name === "UserNotFoundException") {
				return true;
			}

			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "adminDeleteUser", userPoolId, username },
			});
			return false;
		}
	}
}
