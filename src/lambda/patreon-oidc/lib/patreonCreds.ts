import { SecretsManagerDao } from "../shared/aws/SecretsManager.js";

export interface PatreonCreds {
	clientId: string;
	clientSecret: string;
}

let cachedCreds: PatreonCreds | null = null;

export async function loadPatreonCreds(): Promise<PatreonCreds | null> {
	if (cachedCreds) return cachedCreds;

	const secretName = process.env.PATREON_CREDS_SECRET_NAME;
	if (!secretName) return null;

	const raw = await new SecretsManagerDao().GetSecret(secretName);
	if (!raw) return null;

	cachedCreds = JSON.parse(raw) as PatreonCreds;
	return cachedCreds;
}
