/**
 * TShock REST API helper
 */

/**
 * Note:
 * Perms required:
 * - tshock.rest.maintenance
 * - tshock.rest.useapi
 * - tshock.rest.cfg
 */

const {getSecret} = require("../shared/utils/aws");
const http = require("http");
const { successResponse } = require("../shared/utils/response");
const { logAction } = require("../shared/utils/cloudwatchLogger");
const { FUNC_NAMES } = require("../shared/constants");

// Simple per-IP token cache for Lambda warm containers
const tokenCache = new Map(); // ip -> { token, expiresAtMs }

/**
 * Perform an HTTP request and parse JSON body
 */
function httpJsonRequest(url, { method = 'GET', headers = {}, timeout = 5000 }, body = null) {
	return new Promise((resolve, reject) => {
		const req = http.request(url, { method, headers, timeout }, (res) => {
			let chunks = '';
			res.setEncoding('utf8');
			res.on('data', (d) => { chunks += d; });
			res.on('end', () => {
				const statusCode = res.statusCode || 0;
				let json;
				try {
					json = chunks ? JSON.parse(chunks) : {};
				} catch (e) {
					return reject(new Error(`Invalid JSON from ${url} (${statusCode}): ${e.message}`));
				}
				resolve({ statusCode, json });
			});
		});
		req.on('error', (err) => reject(err));
		req.on('timeout', () => {
			req.destroy(new Error(`Request timed out for ${url}`));
		});
		if (body) req.write(body);
		req.end();
	});
}

/**
 * Create a temporary token from TShock using credentials.
 * Uses GET with query params as TShock expects.
 */
async function createTemporaryToken(ipAddress, username, password) {
	const base = `http://${ipAddress}:${process.env.TSHOCK_API_PORT}`;
	const endpoint = `/v2/token/create`;
	
	// TShock expects query params
	const qs = `?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
	const { statusCode, json } = await httpJsonRequest(`${base}${endpoint}${qs}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
	
	if (statusCode >= 200 && statusCode < 300) {
		return parseTokenResponse(json);
	}
	throw new Error(`Failed to create TShock token (HTTP ${statusCode}): ${json?.error || json?.message || JSON.stringify(json)}`);
}

function parseTokenResponse(json) {
	const token = json?.token || json?.Token || json?.access_token || json?.value;
	if (!token) throw new Error('TShock token response missing token field');
	// Determine expiration, accept seconds or ISO string; default 5 minutes if absent
	let expiresAtMs;
	const exp = json?.expiresAt || json?.expires_at || json?.expiry || json?.expiresIn || json?.expires_in;
	if (typeof exp === 'number') {
		// assume seconds from now
		expiresAtMs = Date.now() + exp * 1000;
	} else if (typeof exp === 'string') {
		const t = Date.parse(exp);
		expiresAtMs = isNaN(t) ? undefined : t;
	}
	if (!expiresAtMs) {
		expiresAtMs = Date.now() + 5 * 60 * 1000; // default 5 minutes
	}
	// subtract small safety window
	expiresAtMs -= 30 * 1000;
	return { token, expiresAtMs };
}

async function getAuthTokenForIp(ipAddress, secretName) {
	const cached = tokenCache.get(ipAddress);
	if (cached && cached.expiresAtMs && cached.expiresAtMs > Date.now()) {
		return cached.token;
	}

	const rawSecret = await getSecret(secretName);
	let secret = {};
	try { secret = JSON.parse(rawSecret); } catch { /* plain string */ }

	// If credentials provided, create temp token
	const username = secret.username || secret.user || secret.TSHOCK_USER;
	const password = secret.password || secret.pass || secret.TSHOCK_PASSWORD;
	if (username && password) {
		const { token, expiresAtMs } = await createTemporaryToken(ipAddress, username, password);
		tokenCache.set(ipAddress, { token, expiresAtMs });
		return token;
	}

	// Fallback: use static token from secret (string or field)
	const token = secret.token || secret.TSHOCK_TOKEN || (typeof rawSecret === 'string' ? rawSecret : null);
	if (!token) {
		throw new Error('TShock secret must contain either {username,password} or {token}');
	}
	// Cache static token without expiration (or with long TTL)
	tokenCache.set(ipAddress, { token, expiresAtMs: Date.now() + 24 * 60 * 60 * 1000 });
	return token;
}

/**
 * Call TShock REST API with authentication
 * @param {string} ipAddress - EC2 public IP (or private IP if VPC-local)
 * @param {string} endpoint - TShock REST endpoint path, e.g. "/v2/server/status"
 * @param {object|null} data - Optional data to send as query parameters
 * @param {string} method - HTTP method ('GET' or 'POST'), defaults to 'GET'
 * @returns {Promise<any>} Parsed JSON response from TShock
 */
async function callTShockAPI(userId, ipAddress, endpoint, data = null, method = 'GET') {
	if (!ipAddress) {
		throw new Error("Missing IP address for TShock API call");
	}
	if (!endpoint) {
		throw new Error("Missing endpoint for TShock API call");
	}

	logAction(FUNC_NAMES.SERV_MGR, {
		userId,
		action: "call-tshock-api",
		status: 'pre-call',
		resource: null,
		details: { ipAddress, endpoint, method }
	});

	// Get TShock token from Secrets Manager
	const secretName = process.env.TSHOCK_SECRET_NAME;
	if (!secretName) {
		throw new Error("TSHOCK_SECRET_NAME is not set");
	}
	let token;
	try {
		token = await getAuthTokenForIp(ipAddress, secretName);
	} catch (e) {
		if (e.message.includes("ECONNREFUSED")) {
			return successResponse({ server: { status: false } });
		}
		throw e;
	}

	const baseUrl = `http://${ipAddress}:${process.env.TSHOCK_API_PORT}`;
	
	// Build query parameters: start with token, then add data fields
	const params = new URLSearchParams();
	params.set('token', token);
	if (data) {
		for (const [key, value] of Object.entries(data)) {
			params.set(key, value);
		}
	}
	
	const url = `${baseUrl}${endpoint}?${params.toString()}`;

	const headers = {
		"Content-Type": "application/json",
		Accept: "application/json",
	};

	let statusCode, json;
	try {
		const requestData = await httpJsonRequest(url, { method, headers, timeout: 5000 }, null);
		statusCode = requestData.statusCode;
		json = requestData.json;
	} catch (e) {
		// If the token cache includes a token, but the server has been shut down, it will fail here instead
		if (e.message.includes("ECONNREFUSED")) {
			return successResponse({ server: { status: false } });
		}
		throw e;
	}

	if (statusCode < 200 || statusCode >= 300) {
		const message = json?.message || 'TShock API error';
		throw new Error(`TShock HTTP ${statusCode}: ${message}`);
	}
	return json;
}

module.exports = {callTShockAPI};
