import {InvokeCommand, LambdaClient} from "@aws-sdk/client-lambda";

export class LambdaDao {
	private static instance: LambdaDao | null = null;
	private readonly client!: LambdaClient;

	constructor(region = process.env.AWS_REGION) {
		if (LambdaDao.instance) {
			return LambdaDao.instance;
		}

		this.client = new LambdaClient({region: region || 'us-east-2'});
		LambdaDao.instance = this;
	}

	public async InvokeFunction(payload: any, functionName: string | undefined = undefined): Promise<void> {
		const functionToInvoke = functionName || process.env.AWS_LAMBDA_FUNCTION_NAME;
		if (!functionToInvoke) {
			throw new Error("AWS_LAMBDA_FUNCTION_NAME env var missing");
		}

		await this.client.send(new InvokeCommand({
			FunctionName: functionToInvoke,
			InvocationType: "Event",
			Payload: Buffer.from(JSON.stringify(payload))
		}));
	}
}
