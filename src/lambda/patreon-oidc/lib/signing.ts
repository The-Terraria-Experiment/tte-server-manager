import { SignJWT, exportJWK, importPKCS8, importSPKI, jwtVerify } from "jose";
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

	const parsed = JSON.parse(raw) as SigningKeySecret;
	// The secret is entered by hand in the AWS console, where literal "\n" escape
	// sequences are easy to paste instead of real line breaks - normalize either form
	// so the PEM body decodes correctly regardless of how it was typed in.
	cachedKey = {
		...parsed,
		privateKey: parsed.privateKey.replace(/\\n/g, "\n"),
		publicKey: parsed.publicKey.replace(/\\n/g, "\n"),
	};
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

export interface AccessTokenClaims {
	sub: string;
	email: string | null;
	emailVerified: boolean;
	tierIds: string[];
	issuer: string;
}

/**
 * Cognito calls the userinfo endpoint with this token as a Bearer credential, so unlike the
 * id_token it needs no audience - it's presented back to us, not to Cognito's own JWT verifier.
 */
export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
	const key = await loadSigningKey();
	const privateKey = await importPKCS8(key.privateKey, "RS256");
	const now = Math.floor(Date.now() / 1000);

	return new SignJWT({
		email: claims.email,
		email_verified: claims.emailVerified,
		patreon_tier_ids: claims.tierIds.join(","),
	})
		.setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "at+jwt" })
		.setSubject(claims.sub)
		.setIssuer(claims.issuer)
		.setIssuedAt(now)
		.setExpirationTime(now + 3600)
		.sign(privateKey);
}

export interface VerifiedAccessTokenClaims {
	sub: string;
	email: string | null;
	emailVerified: boolean;
	tierIds: string[];
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessTokenClaims | null> {
	const key = await loadSigningKey();
	const publicKey = await importSPKI(key.publicKey, "RS256");

	try {
		const { payload } = await jwtVerify(token, publicKey);
		if (!payload.sub) return null;

		const tierIdsClaim = payload.patreon_tier_ids;
		return {
			sub: payload.sub,
			email: (payload.email as string | null | undefined) ?? null,
			emailVerified: Boolean(payload.email_verified),
			tierIds: typeof tierIdsClaim === "string" && tierIdsClaim.length > 0 ? tierIdsClaim.split(",") : [],
		};
	} catch {
		return null;
	}
}

export async function getPublicJwk(): Promise<Record<string, unknown>> {
	const key = await loadSigningKey();
	const publicKey = await importSPKI(key.publicKey, "RS256");
	const jwk = await exportJWK(publicKey);

	return { ...jwk, kid: key.kid, use: "sig", alg: "RS256" };
}
