export class Delay implements PromiseLike<void> {
	private readonly promise: Promise<void>;

	public constructor(ms: number) {
		this.promise = new Promise((resolve) => setTimeout(resolve, ms));
	}

	public then<TResult1 = void, TResult2 = never>(
		onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
	): PromiseLike<TResult1 | TResult2> {
		return this.promise.then(onfulfilled ?? undefined, onrejected ?? undefined);
	}

	public static delay(ms: number): Promise<void> {
		return Promise.resolve(new Delay(ms));
	}
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
