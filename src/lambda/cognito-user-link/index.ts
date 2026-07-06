/**
 * Cognito-Dynamo link Lambda
 * - PreSignUp (external providers only): merges a new federated sign-in (e.g. Patreon)
 *   into an existing account when both the incoming and existing email are verified,
 *   instead of letting Cognito create a duplicate user.
 * - PostConfirmation: adds users to Dynamo once they have registered, seeding
 *   permissions from a matched Patreon tier->role mapping when present.
 */

import type { Context, PostConfirmationTriggerEvent, PreSignUpTriggerEvent } from "aws-lambda";
import { DynamoDao } from "./shared/aws/DynamoDB.js";
import { CognitoDao } from "./shared/aws/Cognito.js";
import { PERMISSIONS } from "./shared/permissionValues.js";
import { CWLogger } from "./shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "./shared/constants.js";
import { PATREON_TIERMAP_KEY_PREFIX, ROLE_KEY_PREFIX, SYSTEM_TABLE } from "./shared/vars.js";
import type { PatreonTierMapEntry, RoleEntry } from "./shared/schema/SystemTable.js";

type CognitoTriggerEvent = PreSignUpTriggerEvent | PostConfirmationTriggerEvent;

/**
 * Thrown (not swallowed) when a federated signup collides with an existing account whose own
 * email isn't verified. Auto-linking here would let anyone who merely controls a Patreon/Google
 * account claiming this email hijack the existing, unverified account - Cognito's PreSignUp
 * contract treats a thrown error as a rejected signup, which forces the user to log into the
 * existing account first and use the manual "Link" action instead.
 */
class SignUpBlockedError extends Error {
	constructor(email: string) {
		super(`An account already exists for ${email}. Log in to that account and use "Link Patreon account" instead.`);
		this.name = "SignUpBlockedError";
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function getUserSub(event: CognitoTriggerEvent): string | null {
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

/**
 * Resolves the union of permissions/resourceAccess for a set of Patreon tier IDs,
 * by following each tier's mapped role. Missing/unmapped tiers are silently skipped -
 * this only ever adds bonus grants on top of the default signup permissions.
 */
async function resolveGrantsFromTierIds(
	tierIds: string[],
): Promise<{ permissions: string[]; resourceAccess: string[] }> {
	const DB = new DynamoDao();
	const permissions = new Set<string>();
	const resourceAccess = new Set<string>();

	for (const tierId of tierIds) {
		const tierEntry = (await DB.GetItem(
			SYSTEM_TABLE,
			`${PATREON_TIERMAP_KEY_PREFIX}${tierId}`,
		)) as PatreonTierMapEntry | null;

		if (!tierEntry?.roleId) continue;

		const roleEntry = (await DB.GetItem(SYSTEM_TABLE, `${ROLE_KEY_PREFIX}${tierEntry.roleId}`)) as RoleEntry | null;
		if (!roleEntry) continue;

		(roleEntry.permissions || []).forEach((p) => permissions.add(p));
		(roleEntry.resourceAccess || []).forEach((r) => resourceAccess.add(r));
	}

	return { permissions: [...permissions], resourceAccess: [...resourceAccess] };
}

/**
 * Splits a Cognito federated username (format `<providerName>_<ProviderUserId>`)
 * into its parts. Returns null if the username doesn't look federated (e.g. a
 * native email/password user), since those can't be a link source.
 */
function splitFederatedUsername(username: string): { providerName: string; providerUserId: string } | null {
	const separatorIndex = username.indexOf("_");
	if (separatorIndex <= 0 || separatorIndex === username.length - 1) {
		return null;
	}

	return {
		providerName: username.slice(0, separatorIndex),
		providerUserId: username.slice(separatorIndex + 1),
	};
}

/**
 * Cognito always lowercases the provider-name portion of the auto-generated federated
 * username (e.g. "google_123", "patreon_patreon_456"), regardless of the exact case the
 * identity provider is registered under in the User Pool (seen as "Google"/"Patreon" in
 * the `identities` attribute). AdminLinkProviderForUser requires an exact, case-sensitive
 * match against the registered provider name, so the lowercase prefix must be mapped back
 * to its canonical form or every automatic link attempt silently no-ops.
 */
const PROVIDER_NAME_CANONICAL: Record<string, string> = {
	google: "Google",
	patreon: "Patreon",
};

async function handlePreSignUp(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
	try {
		const { email, email_verified: incomingEmailVerified } = event.request.userAttributes;

		if (!email || incomingEmailVerified !== "true") {
			return event;
		}

		const sourceIdentity = splitFederatedUsername(event.userName);
		if (!sourceIdentity) {
			return event;
		}

		const canonicalProviderName = PROVIDER_NAME_CANONICAL[sourceIdentity.providerName.toLowerCase()];
		if (!canonicalProviderName) {
			return event;
		}

		const existingUser = await new CognitoDao().FindUserByEmail(event.userPoolId, email);
		if (!existingUser) {
			// No matching account - safe to proceed as a normal new signup.
			return event;
		}

		if (!existingUser.emailVerified) {
			throw new SignUpBlockedError(email);
		}

		const linked = await new CognitoDao().AdminLinkProviderForUser(
			event.userPoolId,
			existingUser.username,
			canonicalProviderName,
			sourceIdentity.providerUserId,
		);

		if (linked) {
			event.response.autoConfirmUser = true;
			event.response.autoVerifyEmail = true;

			await CWLogger.Action(FUNC_NAMES.COG_LINK, {
				userId: existingUser.sub,
				action: "account-link",
				resource: event.userPoolId,
				details: { provider: canonicalProviderName },
			});
		}

		return event;
	} catch (error) {
		if (error instanceof SignUpBlockedError) {
			throw error;
		}

		console.error("Error in PreSignUp handler:", getErrorMessage(error));
		// Never block signup on an unexpected linking failure - fall through to normal account creation.
		return event;
	}
}

async function handlePostConfirmation(event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> {
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

		const permissions = new Set<string>([PERMISSIONS.access]);
		const resourceAccess = new Set<string>();

		const tierIdsRaw = event.request.userAttributes["custom:patreon_tiers"];
		if (tierIdsRaw) {
			const tierIds = tierIdsRaw.split(",").map((t) => t.trim()).filter(Boolean);
			const grants = await resolveGrantsFromTierIds(tierIds);
			grants.permissions.forEach((p) => permissions.add(p));
			grants.resourceAccess.forEach((r) => resourceAccess.add(r));
		}

		// Create user record for DynamoDB
		const userRecord = {
			uid: `user#${sub}`,
			sub,
			username,
			displayName: "", // user_xxxx: `User_${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`
			email,
			permissions: [...permissions], // Default role; admins can grant additional roles later,
			resourceAccess: [...resourceAccess],
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
}

export const handler = async (
	event: CognitoTriggerEvent,
	context: Context,
): Promise<CognitoTriggerEvent> => {
	void context;

	console.log(`Cognito User Link - ${event.triggerSource}:`, JSON.stringify(event, null, 2));

	if (event.triggerSource === "PreSignUp_ExternalProvider") {
		return handlePreSignUp(event as PreSignUpTriggerEvent);
	}

	if (event.triggerSource.startsWith("PostConfirmation")) {
		return handlePostConfirmation(event as PostConfirmationTriggerEvent);
	}

	// Any other PreSignUp trigger source (native signup, admin create, etc.) - no linking to do.
	return event;
};
