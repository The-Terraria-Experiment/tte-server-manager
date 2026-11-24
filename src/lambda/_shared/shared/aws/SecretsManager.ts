import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { CWLogger } from "./CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";

/**
 * Reads a secret by name from one of two stores, chosen by the name's shape:
 *
 * - A name starting with `/` (e.g. `/ttesm/tshock-credentials`) is an SSM Parameter Store
 *   `SecureString`, read with decryption.
 * - Anything else is a Secrets Manager secret.
 *
 * The routing exists so secrets can move to Parameter Store (free at the Standard tier, against
 * $0.40/secret/month) one at a time by changing only the `*_SECRET_NAME` env var that names them,
 * and move back the same way. Callers and env var names don't change.
 */
export class SecretsManagerDao {
	private readonly secretsClient: SecretsManagerClient;
	private readonly ssmClient: SSMClient;

	constructor(region = process.env.AWS_REGION) {
		this.secretsClient = new SecretsManagerClient({ region: region || "us-east-2" });
		this.ssmClient = new SSMClient({ region: region || "us-east-2" });
	}

	public static IsParameterName(secretName: string): boolean {
		return secretName.startsWith("/");
	}

	public async GetSecret(secretName: string): Promise<string | undefined> {
		const source = SecretsManagerDao.IsParameterName(secretName) ? "parameter-store" : "secrets-manager";

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-get-secret",
			resource: null,
			details: { secretName, source },
		});

		if (source === "parameter-store") {
			const response = await this.ssmClient.send(new GetParameterCommand({
				Name: secretName,
				WithDecryption: true,
			}));
			return response.Parameter?.Value;
		}

		const response = await this.secretsClient.send(new GetSecretValueCommand({
			SecretId: secretName,
		}));
		return response.SecretString;
	}
}
