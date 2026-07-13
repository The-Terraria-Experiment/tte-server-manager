import {defineAuth, secret} from "@aws-amplify/backend";

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
	loginWith: {
		email: true,
		externalProviders: {
			google: {
				clientId: secret("GOOGLE_CLIENT_ID"),
				clientSecret: secret("GOOGLE_CLIENT_SECRET"),
				scopes: ['openid', 'email', 'profile'],
				// Without this, Cognito never pulls Google's real email_verified claim and every
				// Google-federated user ends up with email_verified: false, which blocks the
				// automatic Patreon<->Google account merge in cognito-user-link/index.ts.
				attributeMapping: {
					email: "email",
					emailVerified: "email_verified",
				},
			},
			oidc: [
				{
					name: "Patreon",
					clientId: secret("PATREON_SHIM_CLIENT_ID"),
					clientSecret: secret("PATREON_SHIM_CLIENT_SECRET"),
					// issuerUrl must be a literal string (Cognito's OIDC IdP config doesn't accept a secret
					// reference here). Base path mapping on the custom domain routes "/auth/patreon/*" to
					// this shim's root-level API resources (see patreon-oidc/index.ts route keys).
					issuerUrl: "https://patreon.auth.theterrariaexperiment.com/auth/patreon",
					scopes: ['openid', 'email'],
					attributeMapping: {
						email: "email",
						emailVerified: "email_verified",
						custom: {
							"custom:patreon_tiers": "patreon_tier_ids",
						},
					},
				},
			],
			callbackUrls: [
				'http://localhost:5173/',
				'https://server.theterrariaexperiment.com/',
				'https://stg-server.theterrariaexperiment.com/',
				'https://sm.auth.theterrariaexperiment.com/oauth2/idpresponse',
			],
			logoutUrls: [
				'http://localhost:5173/',
				'https://server.theterrariaexperiment.com/',
				'https://stg-server.theterrariaexperiment.com/'
			],
		},
	},
	userAttributes: {
		email: {
			required: true,
		},
		// custom:patreon_tiers already exists on the deployed User Pool (added in an earlier
		// deploy attempt). Cognito does not support modifying an existing schema attribute via
		// CloudFormation, so it's intentionally left undeclared here to avoid re-triggering that
		// failure; the OIDC attributeMapping below still references it by name.
	},
	accountRecovery: "EMAIL_ONLY",
});
