/**
 * The shape of an InventoryMonitor player report, and the casing-tolerant reader that produces it.
 *
 * Two consumers need this: `readPlayerInventory` (one player, on demand) and the snapshot scanner
 * (every join capture, in batches). They must agree on the shape exactly — the frontend renders one
 * of them and the rule evaluator reads the other, and a container name or a slot index that differs
 * between the two would show up as a violation highlighting the wrong square.
 */

/**
 * Slot as the InventoryMonitor plugin reports it. `slot` is the index *within* the container;
 * `globalSlot` is the 0-349 TShock NetItem index. The plugin only emits occupied slots, so the
 * client builds each grid at its known fixed size and indexes items in by `slot` rather than
 * mapping over this array.
 */
export type InventorySlotEntry = {
	slot: number,
	globalSlot: number,
	netId: number,
	name: string,
	stack: number,
	prefix: number,
	prefixName: string | null,
	favorited: boolean,
};

export type InventoryContainer = {
	name: string,
	group: string,
	items: InventorySlotEntry[],
};

export type InventoryBuff = {
	id: number,
	name: string,
	ticksRemaining: number,
	secondsRemaining: number,
};

export type InventoryReport = {
	index: number,
	name: string,
	serverSideCharacter: boolean,
	stats: { life: number, lifeMax: number, mana: number, manaMax: number },
	buffs: InventoryBuff[],
	containers: InventoryContainer[],
};

/**
 * The plugin's models are C# properties (`Slot`, `NetId`, `PrefixName`), and whether they reach us
 * PascalCased depends on the serializer settings of whatever TShock build is running — which is not
 * ours to pin. Reading both casings here means the frontend gets one stable camelCase contract
 * regardless, instead of every component having to guess.
 */
export const pick = <T>(source: Record<string, any>, key: string, fallback: T): T => {
	const pascal = key.charAt(0).toUpperCase() + key.slice(1);
	const value = source[key] ?? source[pascal];
	return (value === undefined || value === null) ? fallback : value as T;
};

export const normalizeReport = (raw: Record<string, any>): InventoryReport => {
	const stats = pick<Record<string, any>>(raw, "stats", {});

	return {
		index: pick(raw, "index", -1),
		name: pick(raw, "name", ""),
		serverSideCharacter: pick(raw, "serverSideCharacter", false),
		stats: {
			life: pick(stats, "life", 0),
			lifeMax: pick(stats, "lifeMax", 0),
			mana: pick(stats, "mana", 0),
			manaMax: pick(stats, "manaMax", 0),
		},
		buffs: pick<Record<string, any>[]>(raw, "buffs", []).map(buff => ({
			id: pick(buff, "id", 0),
			name: pick(buff, "name", ""),
			ticksRemaining: pick(buff, "ticksRemaining", 0),
			secondsRemaining: pick(buff, "secondsRemaining", 0),
		})),
		containers: pick<Record<string, any>[]>(raw, "containers", []).map(container => ({
			name: pick(container, "name", ""),
			group: pick(container, "group", ""),
			items: pick<Record<string, any>[]>(container, "items", []).map(item => ({
				slot: pick(item, "slot", -1),
				globalSlot: pick(item, "globalSlot", -1),
				netId: pick(item, "netId", 0),
				name: pick(item, "name", ""),
				stack: pick(item, "stack", 0),
				prefix: pick(item, "prefix", 0),
				prefixName: pick<string | null>(item, "prefixName", null),
				favorited: pick(item, "favorited", false),
			})),
		})),
	};
};

/**
 * `TShockAPI.APIRequest` answers a refused connection with an `APIGatewayProxyResult` rather than
 * TShock JSON — a long-standing contract the "is the server up?" callers rely on. A method typed as
 * returning TShock JSON can therefore hand back a response envelope, and passing that straight to
 * the client would surface as a nonsense body instead of an error.
 */
export const isRefusedConnectionEnvelope = (result: Record<string, any>): boolean =>
	typeof result?.statusCode === "number" && typeof result?.body === "string";
