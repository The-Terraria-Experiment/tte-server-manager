import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CWLogger } from "./CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";

export class SecretsManagerDao {
	private readonly secretsClient: SecretsManagerClient;

	constructor(region = process.env.AWS_REGION) {
		this.secretsClient = new SecretsManagerClient({ region: region || "us-east-2" });
	}

	public async GetSecret(secretName: string): Promise<string | undefined> {
		const command = new GetSecretValueCommand({
			SecretId: secretName,
		});

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-get-secret",
			resource: null,
			details: { secretName },
		});

		const response = await this.secretsClient.send(command);
		return response.SecretString;
	}
}
