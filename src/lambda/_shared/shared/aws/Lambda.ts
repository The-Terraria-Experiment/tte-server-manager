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

	/**
	 * Blocking invoke that returns the target's parsed response.
	 *
	 * The alias-qualification rule from `InvokeFunction` applies here too — an unqualified name
	 * resolves to `$LATEST`, whose `ACTIVE_ENV` is whichever branch deployed last.
	 *
	 * `FunctionError` is checked rather than trusted-by-omission: a target that *throws* still comes
	 * back as a successful invoke (HTTP 200) with the thrown error serialized into the payload, so
	 * without this check the caller would silently treat an error envelope as a valid result.
	 *
	 * There is deliberately no client-side timeout knob: `LambdaDao` is a singleton whose client is
	 * shared with the fire-and-forget path, so a request timeout set here would apply there too. The
	 * bound on this call is the target function's own configured timeout.
	 */
	public async InvokeFunctionSync<T = any>(payload: any, functionName: string): Promise<T> {
		if (!functionName) {
			throw new Error("No target function given for sync invoke");
		}

		const response = await this.client.send(new InvokeCommand({
			FunctionName: functionName,
			InvocationType: "RequestResponse",
			Payload: Buffer.from(JSON.stringify(payload))
		}));

		const raw = response.Payload ? new TextDecoder().decode(response.Payload) : "";

		if (response.FunctionError) {
			// The payload is the serialized error from the target. Surface its message rather than the
			// raw envelope so the substring mapping in errorHandler still has something to work with.
			let detail = raw;
			try {
				const parsed = JSON.parse(raw);
				detail = parsed?.errorMessage || raw;
			} catch { }
			throw new Error(`Invoke of ${functionName} failed (${response.FunctionError}): ${detail}`);
		}

		if (!raw) {
			throw new Error(`Invoke of ${functionName} returned an empty payload`);
		}

		try {
			return JSON.parse(raw) as T;
		} catch (e: any) {
			throw new Error(`Invoke of ${functionName} returned unparseable payload: ${e?.message ?? "unknown"}`);
		}
	}
}
