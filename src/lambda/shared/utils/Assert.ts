export class Assert
{
	public static IsTruthy(condition: unknown, failMessage: string): void
	{
		if (!Boolean(condition)) {
			throw new Error(failMessage);
		}
	}

	public static IsTrue(condition: unknown, failMessage: string): void
	{
		if (condition !== true) {
			throw new Error(failMessage);
		}
	}

	public static IsString(value: unknown, failMessage: string): void
	{
		if (typeof value !== "string" && !(value instanceof String)) {
			throw new Error(failMessage);
		}
	}

	public static IsTruthyString(value: unknown, failMessage: string): void
	{
		Assert.IsTruthy(value, failMessage);
		Assert.IsString(value, failMessage);
	}

	public static ObjectHasKey(object: object, key: PropertyKey, failMessage: string): void
	{
		if (!Object.hasOwn(object, key)) {
			throw new Error(failMessage);
		}
	}

	public static ObjectHasKeys(object: object, keys: PropertyKey[], failMessage: string): void
	{
		try {
			keys.forEach((key) => {
				Assert.ObjectHasKey(object, key, failMessage);
			});
		} catch {
			throw new Error(failMessage);
		}
	}

	public static ObjectHasTruthyKey(object: object, key: PropertyKey, failMessage: string): void
	{
		if (!Object.hasOwn(object, key) || !(object as Record<PropertyKey, unknown>)[key]) {
			throw new Error(failMessage);
		}
	}

	public static ObjectHasTruthyKeys(object: object, keys: PropertyKey[], failMessage: string): void
	{
		try {
			keys.forEach((key) => {
				Assert.ObjectHasTruthyKey(object, key, failMessage);
			});
		} catch {
			throw new Error(failMessage);
		}
	}

	public static Some(assertions: Array<() => void>, failMessage: string): void
	{
		let success = 0;
		assertions.forEach((assertion) => {
			try {
				assertion();
				success++;
			} catch {
				// Continue until at least one assertion succeeds.
			}
		});

		if (!success) {
			throw new Error(failMessage);
		}
	}
}