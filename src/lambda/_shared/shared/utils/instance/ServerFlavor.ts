import { InstanceRegistry } from "./InstanceRegistry.js";

/**
 * Which game server an instance runs, and what that implies for the rest of the backend.
 *
 * Both flavors are driven through the same control REST contract (`docs/contracts/control-rest.md`):
 * TShock serves it natively and the `TteControl` tModLoader mod reproduces it, so the transport and
 * most actions don't branch on this at all. What does differ — how the server is launched, what its
 * config file is, and which features exist — hangs off the descriptor here, so a caller asks
 * `capabilities.has(...)` instead of comparing type strings at every call site.
 *
 * The type is per instance (`serverType` on the `inst#<id>` row) and fixed at provisioning.
 */

export const SERVER_TYPES = ["tshock", "tmodloader"] as const;
export type ServerType = typeof SERVER_TYPES[number];

/** What an absent or unrecognised `serverType` means — every instance predating tModLoader support. */
export const DEFAULT_SERVER_TYPE: ServerType = "tshock";

/**
 * Features that exist on some flavors and not others. Anything both flavors serve identically is
 * deliberately absent — a capability exists to be checked, and checking one that is always present
 * is noise at the call site.
 */
export type ServerCapability =
	/** Live config reload (`/v3/server/reload`). tML's `serverconfig.txt` is launch-time only. */
	| "configReload"
	/** User accounts and groups (`acc:` ban identity, account/group on players and logs). */
	| "accounts"
	/** A mod list that can be viewed and toggled (`/tte/mods`). */
	| "mods";

export type ServerFlavor = {
	type: ServerType,
	/** For user-facing labels ("TShock Version", "Starting TShock", …). */
	displayName: string,
	capabilities: ReadonlySet<ServerCapability>,
};

const FLAVORS: Record<ServerType, ServerFlavor> = {
	tshock: {
		type: "tshock",
		displayName: "TShock",
		capabilities: new Set<ServerCapability>(["configReload", "accounts"]),
	},
	tmodloader: {
		type: "tmodloader",
		displayName: "tModLoader",
		capabilities: new Set<ServerCapability>(["mods"]),
	},
};

export const isServerType = (value: unknown): value is ServerType =>
	typeof value === "string" && (SERVER_TYPES as readonly string[]).includes(value);

/**
 * The flavor for a raw `serverType` value. Anything unrecognised is TShock rather than an error: the
 * attribute is hand-editable in Dynamo, and a typo must not take a working server offline.
 */
export function flavorFor(serverType: unknown): ServerFlavor {
	return FLAVORS[isServerType(serverType) ? serverType : DEFAULT_SERVER_TYPE];
}

/**
 * The flavor an instance runs. Served from `InstanceRegistry`'s cache, so this is free on a warm
 * container. An instance with no `inst#` row at all is TShock — the same answer as a row without the
 * attribute, and the only one that keeps the existing fleet working.
 */
export async function getServerFlavor(instanceId: string): Promise<ServerFlavor> {
	const entry = await InstanceRegistry.GetEntry(instanceId);
	return flavorFor(entry?.serverType);
}
