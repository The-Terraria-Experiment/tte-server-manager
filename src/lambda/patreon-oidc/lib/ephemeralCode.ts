import { randomUUID } from "node:crypto";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { PATREON_CODE_TABLE } from "../shared/vars.js";

export interface EphemeralIdentity {
	patreonUserId: string;
	email: string | null;
	emailVerified: boolean;
	tierIds: string[];
}

const CODE_PREFIX = "code#";
const CODE_TTL_SECONDS = 60;

export async function createCode(identity: EphemeralIdentity): Promise<string> {
	const code = randomUUID();
	const nowSeconds = Math.floor(Date.now() / 1000);

	await new DynamoDao().PutItem(PATREON_CODE_TABLE, {
		uid: `${CODE_PREFIX}${code}`,
		...identity,
		ttl: nowSeconds + CODE_TTL_SECONDS,
	});

	return code;
}

/**
 * Reads and immediately marks a code as consumed via a conditional update, so a
 * replayed/duplicate exchange (or a Cognito retry) reliably fails instead of
 * minting a second id_token from the same Patreon login.
 */
export async function consumeCode(code: string): Promise<EphemeralIdentity | null> {
	const DB = new DynamoDao();
	const key = `${CODE_PREFIX}${code}`;

	const item = await DB.GetItem(PATREON_CODE_TABLE, key);
	if (!item) return null;

	const nowSeconds = Math.floor(Date.now() / 1000);
	if (typeof item.ttl === "number" && item.ttl < nowSeconds) {
		return null;
	}

	// "consumed" is a reserved word in DynamoDB expression syntax, so the condition must
	// reference it through a placeholder rather than as a raw attribute name - otherwise every
	// call throws ValidationException, which UpdateItem swallows and reports as "already used".
	const consumed = await DB.UpdateItem(PATREON_CODE_TABLE, key, {
		UpdateExpression: "SET #consumed = :consumed",
		ExpressionAttributeNames: { "#consumed": "consumed" },
		ExpressionAttributeValues: { ":consumed": true },
		ConditionExpression: "attribute_not_exists(#consumed)",
	});

	if (!consumed) {
		return null;
	}

	return {
		patreonUserId: item.patreonUserId as string,
		email: (item.email as string | null | undefined) ?? null,
		emailVerified: Boolean(item.emailVerified),
		tierIds: (item.tierIds as string[] | undefined) ?? [],
	};
}
