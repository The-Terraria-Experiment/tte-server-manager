import { SignJWT, exportJWK, importPKCS8, importSPKI } from "jose";
import { SecretsManagerDao } from "../shared/aws/SecretsManager.js";

interface SigningKeySecret {
	privateKey: string;
	publicKey: string;
	kid: string;
}

let cachedKey: SigningKeySecret | null = null;

async function loadSigningKey(): Promise<SigningKeySecret> {
	if (cachedKey) return cachedKey;

	const secretName = process.env.SIGNING_KEY_SECRET_NAME;
	if (!secretName) {
		throw new Error("SIGNING_KEY_SECRET_NAME is not configured");
	}

	const raw = await new SecretsManagerDao().GetSecret(secretName);
	if (!raw) {
		throw new Error("Signing key secret not found");
	}

	cachedKey = JSON.parse(raw) as SigningKeySecret;
	return cachedKey;
}

export interface IdTokenClaims {
	sub: string;
	email: string | null;
	emailVerified: boolean;
	tierIds: string[];
	audience: string;
	issuer: string;
}

export async function signIdToken(claims: IdTokenClaims): Promise<string> {
	const key = await loadSigningKey();
	const privateKey = await importPKCS8(key.privateKey, "RS256");
	const now = Math.floor(Date.now() / 1000);

	return new SignJWT({
		email: claims.email,
		email_verified: claims.emailVerified,
		patreon_tier_ids: claims.tierIds.join(","),
	})
		.setProtectedHeader({ alg: "RS256", kid: key.kid })
		.setSubject(claims.sub)
		.setIssuer(claims.issuer)
		.setAudience(claims.audience)
		.setIssuedAt(now)
		.setExpirationTime(now + 3600)
		.sign(privateKey);
}

export async function getPublicJwk(): Promise<Record<string, unknown>> {
	const key = await loadSigningKey();
	const publicKey = await importSPKI(key.publicKey, "RS256");
	const jwk = await exportJWK(publicKey);

	return { ...jwk, kid: key.kid, use: "sig", alg: "RS256" };
}
