import type { LambdaHandler } from "../../../../shared/types/LambdaTypes.js";
import { errorHandler } from "./errorHandler.js";
import { corsHandler } from "./corsHandler.js";

export function createHandler<TEvent = unknown>(handler: LambdaHandler<TEvent>): LambdaHandler<TEvent> {
	return corsHandler(errorHandler(handler));
}
