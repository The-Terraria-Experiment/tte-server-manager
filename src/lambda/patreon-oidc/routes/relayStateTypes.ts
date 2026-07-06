import type { HmacTokenPayload } from "../shared/utils/HmacToken.js";

export interface FederationRelayState extends HmacTokenPayload {
	mode: "federation";
	cognitoState: string;
	cognitoRedirectUri: string;
}

export interface LinkRelayState extends HmacTokenPayload {
	mode: "link";
	username: string;
	sub: string;
}

export interface LinkIntentPayload extends HmacTokenPayload {
	username: string;
	sub: string;
}
