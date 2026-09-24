import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { Ec2Dao, InstanceState } from "../shared/aws/EC2.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { Permissions } from "../shared/utils/core/Perms.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { TShockAPI } from "../shared/utils/tshock/TShockAPI.js";
import { Assert } from "../shared/utils/core/Assert.js";
import { blockIfShutdownInProgress } from "../shared/utils/jobs/ShutdownJob.js";
import { blockIfUnsupported } from "../shared/utils/instance/ServerFlavor.js";

/**
 * The tModLoader mod list (`GET /server/{id}/mods`) and its enable/disable toggle
 * (`POST /server/{id}/mods`), served by TteControl's `/tte/mods` and `/tte/mods/enabled` — see
 * `docs/contracts/control-rest.md`. Installing a mod stays manual (drop the `.tmod` into the `mods`
 * root on the Instance Files page); this only views and toggles what is already there.
 *
 * Both go through the running server because that is the only thing that knows what is *loaded*,
 * which is half of what the tile shows. A toggle rewrites `Mods/enabled.json` and takes effect on the
 * next launch, so `enabled` and `loaded` legitimately disagree until then.
 */

/** tModLoader internal names are C# identifiers; anything else can't name an installed mod. */
const MOD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Disabling it would leave the next launch with no REST server, and so nothing to re-enable it with. */
const CONTROL_MOD = "TteControl";

type ModEntry = {
	name: string,
	displayName: string | null,
	version: string | null,
	enabled: boolean,
	loaded: boolean,
};

/** Drops anything the contract doesn't promise, so the browser never sees a mod's stray extra fields. */
const toModList = (raw: unknown): ModEntry[] => {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((mod) => mod && typeof mod.name === "string")
		.map((mod) => ({
			name: mod.name,
			displayName: typeof mod.displayName === "string" ? mod.displayName : null,
			version: typeof mod.version === "string" ? mod.version : null,
			enabled: mod.enabled === true,
			loaded: mod.loaded === true,
		}));
};

/**
 * The instance's private IP when the server can be asked, or the response to return instead. A box
 * that isn't running is not an error: it has no REST server, so the answer is "nothing to show".
 */
const resolveServerIp = async (serverId: string) => {
	const instance = await new Ec2Dao().GetInstanceStatus(serverId);
	if (instance.state !== InstanceState.RUNNING || !instance.privateIp || instance.privateIp === "PENDING") {
		return { ip: null };
	}
	return { ip: instance.privateIp };
};

/**
 * A refused connection comes back from `APIRequest` as an APIGatewayProxyResult sentinel
 * (`{ statusCode, headers, body }`) rather than as REST JSON — see the note in `getFleetOverview`.
 * Anything else with a `status` other than "200" is the server answering and saying no.
 */
const isUnreachable = (raw: Record<string, any>) => raw?.statusCode !== undefined;
const isRefused = (raw: Record<string, any>) => String(raw?.status) !== "200";

export const readMods = async (event: AuthorizedEvent) => {
	const serverId = event.pathParameters?.id;
	if (!serverId) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverId}`);

	const unsupported = await blockIfUnsupported(serverId, "mods");
	if (unsupported) return unsupported;

	try {
		const { ip } = await resolveServerIp(serverId);
		if (!ip) {
			return ResponseUtil.Success({ running: false, mods: [] });
		}

		const userId = Parsers.GetUserSub(event);
		Assert.IsTruthyString(userId, "No user ID");
		const raw = await new TShockAPI(ip).APIRequest(userId!, "/tte/mods");

		if (isUnreachable(raw)) {
			return ResponseUtil.Success({ running: false, mods: [] });
		}
		if (isRefused(raw)) {
			return ResponseUtil.Error(raw?.error || "The server refused to list its mods", 502, "MODS_READ_FAILED");
		}

		return ResponseUtil.Success({ running: true, mods: toModList(raw.mods) });
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to read mods");
	}
};

export const writeMods = async (event: AuthorizedEvent) => {
	const serverId = event.pathParameters?.id;
	if (!serverId) {
		return ResponseUtil.ValidationError("Server ID is required");
	}

	const { mod, enabled } = event.parsedBody || {};
	if (typeof mod !== "string" || !MOD_NAME.test(mod)) {
		return ResponseUtil.ValidationError("`mod` must be a mod's internal name");
	}
	if (typeof enabled !== "boolean") {
		return ResponseUtil.ValidationError("`enabled` must be true or false");
	}
	// The mod refuses this too; checking here as well means a misbehaving build can't strand the box.
	if (mod === CONTROL_MOD && !enabled) {
		return ResponseUtil.ValidationError(`${CONTROL_MOD} can't be disabled: it is what the site manages the server through`);
	}

	await Permissions.ValidateResourceAccess(event, `server::${serverId}`);

	const blocked = await blockIfShutdownInProgress(serverId);
	if (blocked) return blocked;

	const unsupported = await blockIfUnsupported(serverId, "mods");
	if (unsupported) return unsupported;

	try {
		const { ip } = await resolveServerIp(serverId);
		if (!ip) {
			return ResponseUtil.Error("Start the server to change its mods", 409, "SERVER_NOT_RUNNING");
		}

		const userId = Parsers.GetUserSub(event);
		Assert.IsTruthyString(userId, "No user ID");
		const raw = await new TShockAPI(ip).APIRequest(userId!, "/tte/mods/enabled", { mod, enabled });

		const unreachable = isUnreachable(raw);
		await CWLogger.Action(FUNC_NAMES.SERV_MGR, {
			userId,
			action: "write-mods",
			status: unreachable ? "unreachable" : isRefused(raw) ? "refused" : "ok",
			resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
			details: { serverId, mod, enabled, error: raw?.error ?? null },
		});

		if (unreachable) {
			return ResponseUtil.Error("Start the server to change its mods", 409, "SERVER_NOT_RUNNING");
		}
		if (isRefused(raw)) {
			// The mod's own reason (unknown mod, TteControl) is the useful part — pass it through.
			return ResponseUtil.Error(raw?.error || "The server refused the change", 400, "MODS_WRITE_REFUSED");
		}

		return ResponseUtil.Success({ running: true, mods: toModList(raw.mods) });
	} catch (error: any) {
		return ResponseUtil.Error(error?.message || "Failed to change mods");
	}
};
