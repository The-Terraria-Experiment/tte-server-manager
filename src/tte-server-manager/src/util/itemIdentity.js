/**
 * Item identity, mirrored from the backend's `InventoryReport.ts` (`isModdedItemKey`, `itemIdentity`).
 *
 * tModLoader reports an `itemKey` on every item: `"Terraria/<netId>"` for vanilla, `"ModName/ItemName"`
 * for modded ones. A modded item's `netId` is assigned when the server loads its mods and changes
 * whenever the mod set does, so it must never be used to look anything up — not a rule, and not a
 * sprite or name from the vanilla atlas, where the same number is some unrelated vanilla item (the
 * atlas is a newer Terraria than tModLoader runs, so its ids overlap tModLoader's modded range).
 */

export const VANILLA_ITEM_KEY_PREFIX = "Terraria/";

const ITEM_KEY_SHAPE = /^[A-Za-z_][A-Za-z0-9_]{0,63}\/[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** True for a well-formed modded `itemKey`. Vanilla keys (`Terraria/<n>`) are not modded. */
export const isModdedItemKey = (key) =>
	typeof key === "string" && ITEM_KEY_SHAPE.test(key) && !key.startsWith(VANILLA_ITEM_KEY_PREFIX);

/** True for an item or rule entry that names a modded item. */
export const isModdedItem = (item) => isModdedItemKey(item?.itemKey);

/** The string rule entries and live items are compared on: a modded item's key, otherwise its netId. */
export const itemIdentity = (item) => isModdedItem(item) ? item.itemKey : `netId:${item?.netId}`;

/** "ModName" out of "ModName/ItemName", for labelling where a modded item comes from. */
export const modNameOf = (itemKey) => (isModdedItemKey(itemKey) ? itemKey.split("/")[0] : null);
