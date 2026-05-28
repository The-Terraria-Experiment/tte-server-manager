import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Assert } from "../utils/Assert.js";

export class SqsDao {
	private static instance: SqsDao | null = null;
	private readonly client!: SQSClient;

	constructor(region = process.env.AWS_REGION) {
		if (SqsDao.instance) {
			return SqsDao.instance;
		}

		this.client = new SQSClient({ region: region || "us-east-2" });
		SqsDao.instance = this;
	}

	public async SendMessage(
		queueUrl: string,
		messageBody: unknown,
		delaySeconds: number = 0,
	): Promise<void> {
		Assert.IsTruthyString(queueUrl, "Queue URL is required");
		const boundedDelay = Math.min(Math.max(delaySeconds, 0), 900);
		const payload = typeof messageBody === "string" ? messageBody : JSON.stringify(messageBody ?? {});

		await this.client.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				DelaySeconds: boundedDelay,
				MessageBody: payload,
			}),
		);
	}
}
