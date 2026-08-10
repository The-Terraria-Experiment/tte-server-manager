import {
	AdminDeleteUserCommand,
	AdminLinkProviderForUserCommand,
	ListUsersCommand,
	CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { CWLogger } from "./CloudWatch.js";
import { Assert } from "../utils/core/Assert.js";
import { CW_LOG_GENERAL } from "../constants.js";

export interface CognitoUserLookup {
	username: string;
	sub: string;
	emailVerified: boolean;
}

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

	/**
	 * Link an external provider identity (e.g. a federated Patreon sign-in) to an
	 * existing Cognito user, so future sign-ins from that provider resolve to the
	 * same account instead of creating a duplicate.
	 */
	public async AdminLinkProviderForUser(
		userPoolId: string,
		destinationUsername: string,
		sourceProviderName: string,
		sourceProviderUserId: string,
	): Promise<boolean> {
		Assert.IsTruthyString(userPoolId, "User pool ID required for link");
		Assert.IsTruthyString(destinationUsername, "Destination username required for link");
		Assert.IsTruthyString(sourceProviderName, "Source provider name required for link");
		Assert.IsTruthyString(sourceProviderUserId, "Source provider user ID required for link");

		const cmd = new AdminLinkProviderForUserCommand({
			UserPoolId: userPoolId,
			DestinationUser: {
				ProviderName: "Cognito",
				ProviderAttributeValue: destinationUsername,
			},
			SourceUser: {
				ProviderName: sourceProviderName,
				ProviderAttributeName: "Cognito_Subject",
				ProviderAttributeValue: sourceProviderUserId,
			},
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-cognito-admin-link-provider",
			resource: null,
			details: { userPoolId, destinationUsername, sourceProviderName },
		});

		try {
			await this.client.send(cmd);
			return true;
		} catch (error) {
			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "adminLinkProviderForUser", userPoolId, destinationUsername, sourceProviderName },
			});
			return false;
		}
	}

	/**
	 * Look up a user by email. Returns null on no match. If more than one user shares
	 * the email, also returns null (ambiguous - callers should treat this as "no safe match")
	 * rather than guessing which account to link against.
	 */
	public async FindUserByEmail(userPoolId: string, email: string): Promise<CognitoUserLookup | null> {
		Assert.IsTruthyString(userPoolId, "User pool ID required for lookup");
		Assert.IsTruthyString(email, "Email required for lookup");

		const sanitizedEmail = email.replace(/"/g, '\\"');
		const cmd = new ListUsersCommand({
			UserPoolId: userPoolId,
			Filter: `email = "${sanitizedEmail}"`,
			Limit: 2,
		});

		await CWLogger.CAction(3, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-cognito-find-user-by-email",
			resource: null,
			details: { userPoolId },
		});

		try {
			const response = await this.client.send(cmd);
			const users = response.Users || [];

			if (users.length !== 1) {
				return null;
			}

			const [user] = users;
			const attributes = user?.Attributes || [];
			const getAttr = (name: string) => attributes.find((a) => a.Name === name)?.Value;

			const username = user?.Username;
			const sub = getAttr("sub");
			if (!username || !sub) {
				return null;
			}

			return {
				username,
				sub,
				emailVerified: getAttr("email_verified") === "true",
			};
		} catch (error) {
			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "findUserByEmail", userPoolId },
			});
			return null;
		}
	}
}
