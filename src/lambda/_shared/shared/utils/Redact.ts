const REDACTED = "[REDACTED]";

/**
 * Matched against object keys and against parameter names inside encoded string bodies.
 * Deliberately broad: a false positive costs one unreadable log field, a false negative
 * writes a live credential to CloudWatch permanently.
 */
const SENSITIVE_KEY = /secret|password|passwd|token|authorization|cookie|credential|api[-_]?key/i;

const MAX_DEPTH = 8;

/**
 * Redacts `key=value` pairs whose key looks sensitive, for form-urlencoded bodies
 * (`grant_type=x&client_secret=y`) and bare query strings alike.
 */
function redactEncodedPairs(value: string): string {
	return value.replace(/([^=&?\s]+)=([^&\s]*)/g, (match, key: string) =>
		SENSITIVE_KEY.test(key) ? `${key}=${REDACTED}` : match,
	);
}

function redactString(value: string): string {
	// A JSON body arrives as a string; redact it structurally rather than by regex so
	// nested credentials are caught too.
	const trimmed = value.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			return JSON.stringify(redact(JSON.parse(trimmed)));
		} catch {
			// Not actually JSON - fall through to pair redaction.
		}
	}

	return redactEncodedPairs(value);
}

/**
 * Deep-copies a value with any credential-bearing field replaced by a placeholder, so that
 * Lambda events can be logged without persisting secrets. Lambda events routinely carry
 * credentials - the Patreon OIDC shim's /token route receives the Patreon client_secret in
 * its body, and any authenticated route carries a bearer token in its headers - and
 * CloudWatch retains whatever is written indefinitely.
 */
export function redact(value: unknown, depth = 0): unknown {
	if (depth > MAX_DEPTH) return value;

	if (typeof value === "string") {
		return redactString(value);
	}

	if (Array.isArray(value)) {
		return value.map((entry) => redact(entry, depth + 1));
	}

	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};

		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, depth + 1);
		}

		return output;
	}

	return value;
}

/**
 * Convenience wrapper for the common "stringify an event for a log line" case.
 */
export function redactToJson(value: unknown): string | null {
	if (value === null || value === undefined) return null;

	try {
		return JSON.stringify(redact(value));
	} catch {
		return "[UNSERIALIZABLE]";
	}
}
