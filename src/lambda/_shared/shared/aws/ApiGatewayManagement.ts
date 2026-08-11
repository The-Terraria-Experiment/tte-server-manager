import {
	ApiGatewayManagementApiClient,
	PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { CWLogger } from "./CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";

/**
 * Outcome of a single post. Deliberately a value rather than a thrown error, matching every other DAO
 * in this directory (`DynamoDao` returns `null`/`false`/`[]` on failure).
 *
 * `"gone"` is the interesting one: it is a routine outcome, not a fault. API Gateway returns 410 for
 * a connection the client has already dropped, and the caller's job is to delete the stale row —
 * which is the authoritative cleanup path, since `$disconnect` is best-effort and not guaranteed to
 * fire.
 */
export type PostResult = "ok" | "gone" | "failed";

/**
 * Posts frames to WebSocket clients through the API Gateway Management API.
 *
 * Unlike the other DAOs the underlying client is per **callback endpoint**, not per region — the
 * endpoint identifies the API and stage. Connections record their own endpoint (see
 * `RealtimeConnectionEntry.apiEndpoint`), so this holds a small map of clients rather than one.
 */
export class ApiGatewayManagementDao {
	private static instance: ApiGatewayManagementDao | null = null;
	private readonly clients!: Map<string, ApiGatewayManagementApiClient>;
	private readonly region!: string;

	constructor(region = process.env.AWS_REGION) {
		if (ApiGatewayManagementDao.instance) {
			return ApiGatewayManagementDao.instance;
		}

		this.region = region || "us-east-2";
		this.clients = new Map();
		ApiGatewayManagementDao.instance = this;
	}

	private clientFor(endpoint: string): ApiGatewayManagementApiClient {
		const existing = this.clients.get(endpoint);
		if (existing) {
			return existing;
		}

		const client = new ApiGatewayManagementApiClient({ region: this.region, endpoint });
		this.clients.set(endpoint, client);
		return client;
	}

	/**
	 * Sends one JSON frame to one connection.
	 *
	 * Never throws: fan-out posts to every connection and one dead client must not be able to abort
	 * delivery to the rest.
	 */
	public async PostToConnection(endpoint: string, connectionId: string, payload: unknown): Promise<PostResult> {
		if (!endpoint || !connectionId) {
			return "failed";
		}

		const cmd = new PostToConnectionCommand({
			ConnectionId: connectionId,
			Data: Buffer.from(JSON.stringify(payload), "utf8"),
		});

		try {
			await this.clientFor(endpoint).send(cmd);
			return "ok";
		} catch (error) {
			if (ApiGatewayManagementDao.IsGone(error)) {
				return "gone";
			}

			await CWLogger.Error(CW_LOG_GENERAL, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				details: { action: "postToConnection", endpoint, connectionId },
			});
			return "failed";
		}
	}

	/**
	 * A dropped connection. Checked by both name and HTTP status because which one arrives depends on
	 * the SDK version, and a missed 410 is not a harmless miss — it leaves the row in place, so every
	 * later publish pays to post to a client that will never read it, forever.
	 */
	private static IsGone(error: unknown): boolean {
		const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
		return err?.name === "GoneException" || err?.$metadata?.httpStatusCode === 410;
	}
}
