import * as http from "http";

export type RequestBody = Record<string, any> | string | null;

export class Network {
	public static HTTPJsonRequest(url: string, params: RequestParams, body: RequestBody = null): Promise<RequestResponse> {
		return new Promise((resolve, reject) => {
			const req = http.request(url, params, (res) => {
				let chunks = "";
				res.setEncoding("utf8");

				res.on("data", (chunk) => {
					chunks += chunk;
				});

				res.on("end", () => {
					const statusCode = res.statusCode || 0;
					let json: Record<string, any> = {};

					try {
						json = chunks ? JSON.parse(chunks) : {};
					} catch (err) {
						const error = err instanceof Error ? err : new Error(String(err));
						return reject(new Error(`Invalid JSON from ${url} (${statusCode}): ${error.message}`));
					}

					resolve({statusCode, json});
				});
			});

			req.on("error", (err) => reject(err));
			req.on("timeout", () => {
				req.destroy(new Error(`Request timed out for ${url}`));
			});

			if (body !== null && body !== undefined) {
				const payload = typeof body === "string" ? body : JSON.stringify(body);
				req.write(payload);
			}

			req.end();
		});
	}
}

export type RequestParams = {
	method: HttpMethod;
	headers: Record<string, string>;
	timeout?: number;
};

export type RequestResponse = {
	statusCode: number;
	json: Record<string, any>;
};

export enum HttpMethod {
	GET = "GET",
	POST = "POST",
	PUT = "PUT",
	DELETE = "DELETE",
}
