declare module "aws-jwt-verify" {
	export type TokenUse = "id" | "access";

	export interface VerifyOptions {
		userPoolId: string;
		tokenUse: TokenUse;
		clientId?: string | null;
	}

	export interface CognitoVerifier {
		verify(token: string): Promise<Record<string, unknown>>;
	}

	export const CognitoJwtVerifier: {
		create(options: VerifyOptions): CognitoVerifier;
	};
}
