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
			},
			callbackUrls: [
				'http://localhost:5173/',
				'https://server.terrariaexperiment.click/',
				'https://stg-server.terrariaexperiment.click/',
				'https://stg-server.terrariaexperiment.click/oauth2/idpresponse',
				'https://sm.auth.terrariaexperiment.click/oauth2/idpresponse'
			],
			logoutUrls: [
				'http://localhost:5173/',
				'https://server.terrariaexperiment.click/',
				'https://stg-server.terrariaexperiment.click/'
			],
		},
	},
	userAttributes: {
		email: {
			required: true,
		},
	},
	accountRecovery: "EMAIL_ONLY",
});
