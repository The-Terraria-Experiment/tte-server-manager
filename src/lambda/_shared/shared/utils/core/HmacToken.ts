import { createHmac, timingSafeEqual } from "node:crypto";

export interface HmacTokenPayload {
	exp: number;
	[key: string]: unknown;
}

/**
 * Generic signed, expiring, tamper-evident token (HMAC-SHA256 over a base64url JSON
 * payload). Used to pass short-lived, self-contained state through untrusted hops
 * (e.g. Patreon's OAuth `state` param, or a link-intent handed to the browser)
 * without needing server-side session storage.
 */
export class HmacToken {
	public static Sign<T extends HmacTokenPayload>(payload: T, secret: string): string {
		const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
		const signature = createHmac("sha256", secret).update(body).digest("base64url");
		return `${body}.${signature}`;
	}

	public static Verify<T extends HmacTokenPayload>(token: string, secret: string): T | null {
		const parts = token.split(".");
		if (parts.length !== 2) return null;

		const [body, signature] = parts;
		if (!body || !signature) return null;

		const expectedSignature = createHmac("sha256", secret).update(body).digest("base64url");

		const signatureBuffer = Buffer.from(signature);
		const expectedBuffer = Buffer.from(expectedSignature);
		if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
			return null;
		}

		try {
			const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
			if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
				return null;
			}
			return payload;
		} catch {
			return null;
		}
	}
}
