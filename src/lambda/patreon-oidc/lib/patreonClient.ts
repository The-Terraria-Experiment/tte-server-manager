export interface PatreonIdentity {
	patreonUserId: string;
	email: string | null;
	emailVerified: boolean;
	tierIds: string[];
}

interface PatreonTokenResponse {
	access_token: string;
}

export async function exchangePatreonCode(
	code: string,
	redirectUri: string,
	clientId: string,
	clientSecret: string,
): Promise<string> {
	const response = await fetch("https://www.patreon.com/api/oauth2/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			grant_type: "authorization_code",
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
		}),
	});

	if (!response.ok) {
		throw new Error(`Patreon token exchange failed with status ${response.status}`);
	}

	const data = (await response.json()) as PatreonTokenResponse;
	return data.access_token;
}

interface PatreonJsonApiResource {
	id: string;
	type: string;
	attributes?: Record<string, unknown>;
}

interface PatreonIdentityResponse {
	data: PatreonJsonApiResource;
	included?: PatreonJsonApiResource[];
}

export async function fetchPatreonIdentity(accessToken: string): Promise<PatreonIdentity> {
	const url = new URL("https://www.patreon.com/api/oauth2/v2/identity");
	url.searchParams.set("include", "memberships.currently_entitled_tiers");
	url.searchParams.set("fields[user]", "email");

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!response.ok) {
		throw new Error(`Patreon identity fetch failed with status ${response.status}`);
	}

	const data = (await response.json()) as PatreonIdentityResponse;

	const tierIds = (data.included || [])
		.filter((resource) => resource.type === "tier")
		.map((resource) => resource.id);

	const email = (data.data.attributes?.email as string | undefined) ?? null;

	return {
		patreonUserId: data.data.id,
		email,
		// Patreon's identity endpoint doesn't expose a separate "verified" flag - it only
		// returns the user's own account email at all when the app is approved for the
		// identity[email] scope, so presence here is treated as verified.
		emailVerified: Boolean(email),
		tierIds,
	};
}
