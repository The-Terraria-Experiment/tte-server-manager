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

	/**
	 * Fire-and-forget async invoke.
	 *
	 * `functionName` is required, and should almost always be `context.invokedFunctionArn` for a
	 * self-invoke or an alias-qualified ARN from env for a cross-lambda one. This used to default to
	 * `AWS_LAMBDA_FUNCTION_NAME`, which is **unqualified**: the invoke landed on `$LATEST`, whose
	 * `ACTIVE_ENV` is whichever branch happened to deploy most recently. A worker that picks its
	 * Dynamo tables and its target EC2 instance from `ACTIVE_ENV` would then act on the wrong
	 * environment — silently, and only sometimes. Making the target explicit is what stops that from
	 * being the easy thing to write.
	 */
	public async InvokeFunction(payload: any, functionName: string): Promise<void> {
		const functionToInvoke = functionName;
		if (!functionToInvoke) {
			throw new Error("No target function given for async invoke");
		}

		await this.client.send(new InvokeCommand({
			FunctionName: functionToInvoke,
			InvocationType: "Event",
			Payload: Buffer.from(JSON.stringify(payload))
		}));
	}
}
