/**
 * Contract drift check: calls a live game server's REST API the way the backend does and checks each
 * response against `docs/contracts/`. Run by hand after upgrading TShock, tModLoader, a plugin or a
 * mod. See README.md.
 *
 *   npm run check -- --instance i-0547061b934ecd3cd [--alias stage] [--player Name]
 *
 * **Read-only by construction.** Only the endpoints below are ever called. Nothing that stops the
 * server, kicks, bans, removes or clears. `/inventory/snapshots` is a non-destructive cursor (no ack,
 * no delete), so reading one page consumes nothing the item-rule scanner relies on.
 *
 * It goes through the `tshock-proxy` lambda rather than dialling the box, because the REST port is
 * closed to everything outside the VPC, and because that is the exact path production traffic takes.
 * The credential travels in the invoke payload, which is never persisted. Sending it through SSM
 * would write it into the command history.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LambdaClient, GetFunctionConfigurationCommand, InvokeCommand } from "@aws-sdk/client-lambda";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const REGION = "us-east-2";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(HERE, "../../docs/contracts");

// ------------------------------------------------------------------------------------------ args

function parseArgs(argv) {
	const args = { instance: null, alias: "stage", player: null, serverManager: "ttesm-server-manager" };
	for (let i = 0; i < argv.length; i++) {
		const next = () => argv[++i];
		if (argv[i] === "--instance") args.instance = next();
		else if (argv[i] === "--alias") args.alias = next();
		else if (argv[i] === "--player") args.player = next();
		else if (argv[i] === "--server-manager") args.serverManager = next();
	}
	if (!args.instance) {
		throw new Error("Usage: npm run check -- --instance <ec2 id> [--alias stage|prod] [--player <name>]");
	}
	return args;
}

// ------------------------------------------------------------------------------------------ results

const results = [];
let current = "";

/** Records one expectation. `detail` explains a failure; it's never printed for a pass. */
function expect(label, ok, detail = "") {
	results.push({ section: current, label, ok: Boolean(ok), detail: ok ? "" : detail });
	return Boolean(ok);
}

const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === "string";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Case-insensitive key read. The contract allows PascalCase or camelCase for nested keys (TShock's
 * serializer settings decide), exactly as the backend's `pick` does.
 */
function pick(obj, key) {
	if (!isObj(obj)) return undefined;
	if (key in obj) return obj[key];
	const match = Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase());
	return match === undefined ? undefined : obj[match];
}

// ------------------------------------------------------------------------------------------ AWS

async function loadConfig(args) {
	const lambda = new LambdaClient({ region: REGION });
	const fn = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: args.serverManager, Qualifier: args.alias }));
	const env = fn.Environment?.Variables ?? {};
	for (const key of ["TSHOCK_PROXY_FUNCTION_ARN", "TSHOCK_SECRET_NAME", "TSHOCK_API_PORT", "INSTANCE_TABLE_NAME"]) {
		if (!env[key]) throw new Error(`${args.serverManager}:${args.alias} has no ${key}; can't reach the server the way the backend does`);
	}

	const secret = await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: env.TSHOCK_SECRET_NAME }));
	const parsed = JSON.parse(secret.SecretString ?? "{}");
	if (!parsed.TSHOCK_USER || !parsed.TSHOCK_PASSWORD) throw new Error("REST secret is missing TSHOCK_USER/TSHOCK_PASSWORD");

	const row = await new DynamoDBClient({ region: REGION }).send(new GetItemCommand({
		TableName: env.INSTANCE_TABLE_NAME,
		Key: { uid: { S: `inst#${args.instance}` } },
	}));
	const serverType = row.Item?.serverType?.S === "tmodloader" ? "tmodloader" : "tshock";

	const described = await new EC2Client({ region: REGION }).send(new DescribeInstancesCommand({ InstanceIds: [args.instance] }));
	const instance = described.Reservations?.[0]?.Instances?.[0];
	if (instance?.State?.Name !== "running" || !instance.PrivateIpAddress) {
		throw new Error(`${args.instance} isn't running (${instance?.State?.Name ?? "not found"}). Start it and launch a world first.`);
	}

	return {
		lambda,
		proxyArn: `${env.TSHOCK_PROXY_FUNCTION_ARN}:${args.alias}`,
		port: env.TSHOCK_API_PORT,
		credential: { username: parsed.TSHOCK_USER, password: parsed.TSHOCK_PASSWORD },
		address: instance.PrivateIpAddress,
		serverType,
	};
}

/** One REST call through tshock-proxy, returning the server's JSON. */
async function call(config, endpoint, params = undefined) {
	const payload = {
		requestType: "tshock-call",
		address: config.address,
		port: config.port,
		endpoint,
		method: "GET",
		credential: config.credential,
		userID: "contract-check",
		...(params ? { params } : {}),
	};
	const response = await config.lambda.send(new InvokeCommand({
		FunctionName: config.proxyArn,
		Payload: Buffer.from(JSON.stringify(payload)),
	}));
	const result = JSON.parse(Buffer.from(response.Payload ?? []).toString("utf8") || "null");
	if (response.FunctionError || !result) {
		throw new Error(`proxy invoke failed for ${endpoint}: ${response.FunctionError ?? "empty response"}`);
	}
	if (!result.ok) {
		throw new Error(result.reason === "connection-refused"
			? `nothing is listening on the REST port. Is a world running?`
			: `proxy error on ${endpoint}: ${result.message}`);
	}
	return result.json;
}

/** `contractVersion` from the top of each doc, so there is no second copy of it here to drift. */
async function readContractVersions() {
	const versions = {};
	for (const name of ["control-rest", "inventory-monitor", "event-push"]) {
		const text = await readFile(path.join(CONTRACTS_DIR, `${name}.md`), "utf8");
		const match = /`contractVersion`:\s*\*\*(\d+\.\d+)\*\*/.exec(text);
		if (match) versions[name] = match[1];
	}
	return versions;
}

// ------------------------------------------------------------------------------------------ checks

const ITEM_KEY = /^[A-Za-z_][A-Za-z0-9_]*\/[A-Za-z0-9_]+$/;
const CONTAINER_GROUPS = new Set(["core", "storage", "misc", "loadouts"]);

/** A player report (`inventory-monitor.md`, "The report"). */
function checkReport(report, where, isTml) {
	if (!expect(`${where}: is an object`, isObj(report), typeof report)) return;

	expect(`${where}: name is a non-empty string`, isStr(pick(report, "name")) && pick(report, "name").length > 0, JSON.stringify(pick(report, "name")));
	expect(`${where}: index >= 0`, isInt(pick(report, "index")) && pick(report, "index") >= 0, JSON.stringify(pick(report, "index")));
	expect(`${where}: serverSideCharacter is a boolean`, typeof pick(report, "serverSideCharacter") === "boolean", JSON.stringify(pick(report, "serverSideCharacter")));
	if (isTml) {
		expect(`${where}: account is null (tML)`, pick(report, "account") === null, JSON.stringify(pick(report, "account")));
		expect(`${where}: group is "" (tML)`, pick(report, "group") === "", JSON.stringify(pick(report, "group")));
	}

	const containers = pick(report, "containers");
	if (!expect(`${where}: containers is an array`, Array.isArray(containers), typeof containers)) return;

	let items = 0;
	const problems = new Set();
	for (const container of containers) {
		if (!isStr(pick(container, "name"))) problems.add("container without a name");
		if (!CONTAINER_GROUPS.has(String(pick(container, "group")).toLowerCase())) problems.add(`unknown container group ${JSON.stringify(pick(container, "group"))}`);
		const list = pick(container, "items");
		if (!Array.isArray(list)) { problems.add("container items isn't an array"); continue; }
		if (!list.length) problems.add("empty container listed (empty containers must be omitted)");

		for (const item of list) {
			items++;
			const globalSlot = pick(item, "globalSlot");
			const netId = pick(item, "netId");
			if (!isInt(pick(item, "slot"))) problems.add("item slot isn't an integer");
			if (!isInt(globalSlot) || globalSlot < 0 || globalSlot > 349) problems.add(`globalSlot out of 0-349: ${globalSlot}`);
			if (!isInt(netId) || netId === 0) problems.add(`netId invalid: ${netId}`);
			if (!isStr(pick(item, "name"))) problems.add("item name isn't a string");
			if (!isInt(pick(item, "stack")) || pick(item, "stack") < 1) problems.add(`stack invalid: ${pick(item, "stack")}`);
			if (!isInt(pick(item, "prefix"))) problems.add("prefix isn't an integer");
			if (typeof pick(item, "favorited") !== "boolean") problems.add("favorited isn't a boolean");
			if (isTml) {
				const key = pick(item, "itemKey");
				if (!isStr(key) || !ITEM_KEY.test(key)) problems.add(`itemKey malformed: ${JSON.stringify(key)}`);
				else if (key.startsWith("Terraria/") && key !== `Terraria/${netId}`) problems.add(`vanilla itemKey ${key} doesn't match netId ${netId}`);
			}
		}
	}
	expect(`${where}: ${items} item(s) across ${containers.length} container(s) well-formed`, problems.size === 0, [...problems].slice(0, 5).join("; "));
}

async function checkStatus(config, contractVersions) {
	current = "/v2/server/status";
	const isTml = config.serverType === "tmodloader";
	const s = await call(config, "/v2/server/status", { players: true, rules: true });

	expect('status is the string "200"', s.status === "200", JSON.stringify(s.status));
	for (const key of ["name", "world", "uptime", "serverversion"]) {
		expect(`${key} is a string`, isStr(s[key]), JSON.stringify(s[key]));
	}
	for (const key of ["port", "playercount", "maxplayers"]) {
		expect(`${key} is a number`, typeof s[key] === "number", JSON.stringify(s[key]));
	}
	expect("uptime is d.hh:mm:ss", /^\d+\.\d{2}:\d{2}:\d{2}$/.test(String(s.uptime)), JSON.stringify(s.uptime));
	expect("players is an array", Array.isArray(s.players), typeof s.players);
	expect("every player has a nickname", (s.players ?? []).every((p) => isStr(pick(p, "nickname"))), JSON.stringify(s.players));
	expect("playercount matches players.length", s.playercount === (s.players ?? []).length, `${s.playercount} vs ${(s.players ?? []).length}`);
	expect("rules is a key -> scalar map", isObj(s.rules) && Object.values(s.rules).every((v) => v === null || typeof v !== "object"), JSON.stringify(s.rules)?.slice(0, 120));

	if (isTml) {
		expect('serverType is "tmodloader"', s.serverType === "tmodloader", JSON.stringify(s.serverType));
		expect("tmodloaderversion is a string", isStr(s.tmodloaderversion), JSON.stringify(s.tmodloaderversion));
		expect("mods is an array of { name, displayName, version }",
			Array.isArray(s.mods) && s.mods.every((m) => isStr(m.name) && isStr(m.displayName) && isStr(m.version)),
			JSON.stringify(s.mods)?.slice(0, 160));
		expect("TteControl is loaded", (s.mods ?? []).some((m) => m.name === "TteControl"), JSON.stringify((s.mods ?? []).map((m) => m.name)));
	} else {
		expect("tshockversion is a string", isStr(s.tshockversion), JSON.stringify(s.tshockversion));
	}

	// Absent is allowed (TShock reports nothing and means the 1.0 baseline); present must agree on major.
	const reported = s.contractVersions;
	if (reported !== undefined || isTml) {
		expect("contractVersions is an object", isObj(reported), JSON.stringify(reported));
		for (const [name, version] of Object.entries(isObj(reported) ? reported : {})) {
			const expected = contractVersions[name];
			if (!expected) continue;
			expect(`${name} ${version} matches the doc's major (${expected})`,
				String(version).split(".")[0] === expected.split(".")[0],
				`server ${version}, docs/contracts ${expected}`);
		}
		if (isTml) {
			expect("reports control-rest", isObj(reported) && isStr(reported["control-rest"]), JSON.stringify(reported));
		}
	}

	return s;
}

async function checkMods(config) {
	current = "/tte/mods";
	const r = await call(config, "/tte/mods");
	expect('status is the string "200"', r.status === "200", JSON.stringify(r.status));
	const ok = expect("mods is an array of { name, displayName, version, enabled, loaded }",
		Array.isArray(r.mods) && r.mods.every((m) => isStr(m.name) && isStr(m.displayName) && isStr(m.version) && typeof m.enabled === "boolean" && typeof m.loaded === "boolean"),
		JSON.stringify(r.mods)?.slice(0, 200));
	if (ok) {
		const control = r.mods.find((m) => m.name === "TteControl");
		expect("TteControl is listed, enabled and loaded", control?.enabled && control?.loaded, JSON.stringify(control));
	}
}

async function checkItemNames(config) {
	current = "/inventory/itemnames";
	const isTml = config.serverType === "tmodloader";
	const r = await call(config, "/inventory/itemnames");
	expect('status is the string "200"', r.status === "200", JSON.stringify(r.status));
	expect("version is a string", isStr(r.version), JSON.stringify(r.version));
	const count = Object.keys(isObj(r.items) ? r.items : {}).length;
	expect("items is a netId -> name map", isObj(r.items) && Object.entries(r.items).every(([k, v]) => /^-?\d+$/.test(k) && isStr(v)), "non-numeric key or non-string name");
	expect("items looks complete (>= 3000)", count >= 3000, `${count} entries`);
	expect("count matches items", r.count === count, `${r.count} vs ${count}`);
	if (isTml) {
		expect("modItems is an itemKey -> name map",
			isObj(r.modItems) && Object.entries(r.modItems).every(([k, v]) => ITEM_KEY.test(k) && !k.startsWith("Terraria/") && isStr(v)),
			JSON.stringify(r.modItems)?.slice(0, 160));
	}
}

async function checkSnapshots(config) {
	current = "/inventory/snapshots";
	const isTml = config.serverType === "tmodloader";
	// since=0&limit=1: the oldest retained capture, if any. A read, not a consume: the scanner's cursor
	// is persisted on our side and nothing here moves it.
	const r = await call(config, "/inventory/snapshots", { since: 0, limit: 1 });
	expect('status is the string "200"', r.status === "200", JSON.stringify(r.status));
	for (const key of ["cursor", "head", "count", "retained"]) {
		expect(`${key} is an integer`, isInt(r[key]), JSON.stringify(r[key]));
	}
	expect("more is a boolean", typeof r.more === "boolean", JSON.stringify(r.more));
	expect("snapshots is an array of at most `limit`", Array.isArray(r.snapshots) && r.snapshots.length <= 1, JSON.stringify(r.snapshots?.length));
	expect("count matches snapshots.length", r.count === (r.snapshots ?? []).length, `${r.count}`);
	expect("cursor <= head", r.cursor <= r.head, `${r.cursor} > ${r.head}`);

	const snap = r.snapshots?.[0];
	if (snap) {
		expect("snapshot id is an integer > 0", isInt(snap.id) && snap.id > 0, JSON.stringify(snap.id));
		expect('kind is "join" or "leave"', snap.kind === "join" || snap.kind === "leave", JSON.stringify(snap.kind));
		expect("capturedAtUtc parses as a date", !Number.isNaN(Date.parse(snap.capturedAtUtc)), JSON.stringify(snap.capturedAtUtc));
		expect("cursor is this page's max id", r.cursor === snap.id, `${r.cursor} vs ${snap.id}`);
		checkReport(snap.player, "snapshot report", isTml);
	} else {
		expect("empty page: cursor equals since (0)", r.cursor === 0, JSON.stringify(r.cursor));
	}
}

async function checkRead(config, playerName) {
	current = "/inventory/read";
	const r = await call(config, "/inventory/read", { player: playerName, include: "core,storage,misc,loadouts" });
	expect('status is the string "200"', r.status === "200", JSON.stringify(r.status) + (r.error ? ` (${r.error})` : ""));
	checkReport(r.player, `report for ${playerName}`, config.serverType === "tmodloader");

	const missing = await call(config, "/inventory/read", { player: "contract-check-no-such-player" });
	expect('unknown player answers {status:"400", error}', missing.status === "400" && isStr(missing.error), JSON.stringify(missing).slice(0, 160));
}

// ------------------------------------------------------------------------------------------ main

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const config = await loadConfig(args);
	const contractVersions = await readContractVersions();

	console.log(`Checking ${args.instance} (${config.serverType}) through tshock-proxy:${args.alias} against docs/contracts ${JSON.stringify(contractVersions)}\n`);

	const guard = async (section, fn) => {
		try {
			await fn();
		} catch (error) {
			current = section;
			expect("request succeeded", false, error.message);
		}
	};

	// A refused connection means no world is running, which makes every later check the same failure.
	// Say so once and stop, rather than printing it per endpoint as if four things were broken.
	try {
		await call(config, "/v2/server/status");
	} catch (error) {
		console.error(`Can't reach the server: ${error.message}`);
		process.exitCode = 2;
		return;
	}

	let status = null;
	await guard("/v2/server/status", async () => { status = await checkStatus(config, contractVersions); });
	if (config.serverType === "tmodloader") {
		await guard("/tte/mods", () => checkMods(config));
	}
	await guard("/inventory/itemnames", () => checkItemNames(config));
	await guard("/inventory/snapshots", () => checkSnapshots(config));

	const player = args.player ?? pick(status?.players?.[0] ?? {}, "nickname");
	if (player) {
		await guard("/inventory/read", () => checkRead(config, player));
	} else {
		console.log("(nobody online and no --player given: skipping /inventory/read)\n");
	}

	let section = null;
	for (const result of results) {
		if (result.section !== section) {
			section = result.section;
			console.log(section);
		}
		console.log(`  ${result.ok ? "PASS" : "FAIL"}  ${result.label}${result.ok ? "" : `\n        ${result.detail}`}`);
	}

	const failed = results.filter((r) => !r.ok).length;
	console.log(`\n${results.length - failed} passed, ${failed} failed`);
	process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 2;
});
