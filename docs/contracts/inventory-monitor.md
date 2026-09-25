# Contract: inventory monitor REST API

`contractVersion`: **1.1**
- 1.0 is what [`tshock-inventory-monitor`](https://github.com/The-Terraria-Experiment/tshock-inventory-monitor) serves today.
- 1.1 adds `itemKey` and the other **(tML extension)** items.

The inventory monitor lets the backend read player inventories, capture them on join and leave, and
remove items.
- **TShock:** a plugin registering routes on TShock's REST server.
- **tModLoader:** the `tml-inventory-monitor` mod registering the same routes on `TteControl`'s REST host.

Transport, token auth, the response envelope and the "connection refused = server not running" rule
are all inherited from [control-rest.md](control-rest.md) and are not repeated here.

**What depends on it:**
- the player inventory popup: read, remove and clear
- CAPTURE ALL & DOWNLOAD: `readall`
- the item-rule scanner and auto-kick: the snapshot drain
- the S3 snapshot archive
- `src/sprite-tools/names.mjs`: `itemnames`

## The report

A report is one player's full inventory surface. Keys may be PascalCase or camelCase (see
[README](README.md)); new implementations should emit camelCase. The backend normalizes reports in
`normalizeReport` (`_shared/shared/utils/tshock/InventoryReport.ts`). That function is the
authoritative list of what is read.

```jsonc
{
  "index": 3,                    // player slot; >= 0 for a real player
  "name": "Alice",
  "account": "alice",            // TShock account; tML: null
  "group": "default",            // TShock group; tML: ""
  "ip": "203.0.113.7",
  "position": "1234,567",
  "serverSideCharacter": false,  // true only when the server owns inventories (SSC)
  "stats": { "life": 400, "lifeMax": 500, "mana": 200, "manaMax": 200 },
  "buffs": [ { "id": 1, "name": "Obsidian Skin", "ticksRemaining": 3600, "secondsRemaining": 60 } ],
  "containers": [
    { "name": "Inventory", "group": "Core", "items": [
      { "slot": 0, "globalSlot": 0, "netId": 757, "name": "Terra Blade", "stack": 1,
        "prefix": 81, "prefixName": "Legendary", "favorited": true,
        "itemKey": "Terraria/757" }              // (tML extension, 1.1)
    ] }
  ]
}
```

Rules that are easy to get wrong:

- **`globalSlot` is the address; `slot` is not.** `slot` is container-local and repeats in every container. Removal takes `globalSlot`, and passing `slot` destroys the wrong item while looking successful.
- **Only non-empty slots are listed, and a container with no items is omitted entirely.** An empty `containers` array therefore means *the player carries nothing*. It never means the plugin is missing. Player identity (`name`/`index`) must always be populated so the backend can tell the two apart (`isPlayerFound`).
- **`buffs[].ticksRemaining`** is `-1` for an effectively permanent buff.
- **`group` on a container** is the `ReportGroups` name: `Core`, `Storage`, `Misc` or `Loadouts`.

### Containers and global slots

These match Terraria's `PlayerSlot` packet numbering, which is TShock's `NetItem` layout. The
frontend's `InventoryGrid.vue` renders by these names and ranges. **Do not renumber.**

| globalSlot | Container name | Group |
|---|---|---|
| 0–58 | `Inventory` (coins 50–53, ammo 54–57) | Core |
| 59–78 | `Armor` (armor, accessories, vanity) | Core |
| 79–88 | `Dyes` | Core |
| 89–93 | `MiscEquips` | Misc |
| 94–98 | `MiscDyes` | Misc |
| 99–138 | `PiggyBank` | Storage |
| 139–178 | `Safe` | Storage |
| 179 | `Trash` | Storage |
| 180–219 | `Forge` | Storage |
| 220–259 | `VoidVault` | Storage |
| 260–279 / 280–289 | `Loadout1Armor` / `Loadout1Dyes` | Loadouts |
| 290–309 / 310–319 | `Loadout2Armor` / `Loadout2Dyes` | Loadouts |
| 320–339 / 340–349 | `Loadout3Armor` / `Loadout3Dyes` | Loadouts |

**(tML extension, not in 1.1):** extra accessory slots added by mods (`ModAccessorySlot`) live outside
`player.armor` and have no vanilla slot number.
- 1.1 implementations **omit them**.
- The planned extension is a `ModAccessories` container (Core group) at `globalSlot` ≥ 350. It needs `InventoryGrid.vue` support first, so don't emit it until this document defines it.

### Item identity: `netId` and `itemKey`

- **`netId`** is Terraria's item type. It is stable for **vanilla** items, and negative values (legacy variants) are valid. `0` is never a real item.
- **(tML extension) `itemKey`** is a stable identity string:
  - `"Terraria/<netId>"` for vanilla items
  - `ModItem.FullName` (`"ModName/ItemName"`) for modded ones

  **Modded `netId`s are assigned at load time and change whenever the enabled mod set changes.** Anything persisted has to key on `itemKey`: item rules, archived snapshots, and the removal "still the same item?" check. A persisted modded `netId` points at a different item after the next mod change.
- **`name`** is the display name from the server's loaded localization.

## Endpoints

### `GET /inventory/read`

| Param | Meaning |
|---|---|
| `player` | player name |
| `include` | optional group filter, a comma list of `core,storage,misc,loadouts` (default all). The backend always sends all four |

The response is `{ "status": "200", "player": <report> }`. An unknown player gives `{ "status": "400", "error": "…" }`, and the backend quotes `error` to the operator.

### `GET /inventory/readall`

`include` works as above.

The response is `{ "status": "200", "playercount": n, "players": [<report>, …] }`, covering every active player up to `ReadAllMaxPlayers` (255). The backend flags `truncated` when `playercount` reaches that cap.

### `GET /inventory/snapshots`: the drain

This is the only snapshot query the backend makes: `since=<cursor>&limit=<n>&include=<groups>`, repeated while `more` is true (`drainSnapshots`, `_shared/shared/utils/tshock/InventorySnapshots.ts`).

```jsonc
{
  "status": "200",
  "snapshots": [ { "id": 8413, "kind": "join", "capturedAtUtc": "2026-09-23T18:00:00Z",
                   "player": <report>, "itemCount": 42, "stale": true } ],
  "count": 1,
  "cursor": 8413,        // max id in this page; `since` if the page is empty
  "head": 8900,          // highest id issued by this process
  "more": false,         // page was full AND newer ids exist
  "retained": 612,
  "oldestRetainedUtc": "2026-09-23T17:01:12Z"
}
```

Semantics the backend's correctness depends on:

1. **`since` is an exclusive id floor.** There is no ack and no delete, so the backend's persisted cursor is the only record of what has been consumed.
2. **Ids are process-unique, monotonically increasing, and restart at 1 when the server restarts.** The backend detects a restart as `head < cursor` and re-drains from 0. It also uses this to split sessions (`ServerSession.rollSession`), so ids must genuinely restart. Persisting them across restarts would hide every restart.
3. **Oldest-first without `latest`.** The backend never sends `latest=true`, `player=` or `kind=`. `cursor` is the page's max id, so a newest-first page would advance past unread ids, and filtered pages make `more` unreliable. Implement those filters for ad-hoc use if you like, but the drain must work without them.
4. **Two captures per session:** `join` (taken `JoinSnapshotDelayTicks` after greet, so the client's slot packets have landed) and `leave` (taken while the player object is still intact). Only `join` captures are evaluated against item rules, but the drain passes over both.
5. **Retention:** in memory, about 60 minutes by default. The backend compares `oldestRetainedUtc` with its last scan to detect a gap. It is not recoverable, but it is logged.
6. **`stale`** is `!serverSideCharacter`.

### `GET /inventory/removeslot`

| Param | Meaning |
|---|---|
| `player` | player name |
| `slot` | a **`globalSlot`** |

The response is `{ "status": "200", "removed": true, "item": {…}, "note": "…" }`.

### `GET /inventory/clear`

| Param | Meaning |
|---|---|
| `player` | player name |
| `scope` | `all` (default), `main` (the `Inventory` container only), `core`, `storage`, `misc` or `loadouts` |

The response is `{ "status": "200", "scope": "…", "slotsCleared": n, "note": "…" }`.

**Removal requires ServerSideCharacters.** Without SSC the client owns its inventory and discards the server's `PlayerSlot` packet, so clearing the server's copy would make the server report items the player still has.
- Both removal endpoints **refuse with `{ "status": "400", "error": "<reason>" }` and change nothing** when SSC is off. The backend records each refusal per slot (`failed[]`).
- tModLoader also uses client-owned characters, and this rule carries over unchanged.
- The plugin README's "Removal & ServerSideCharacters" section has the protocol detail. CLAUDE.md's older note describing removals that "succeed but don't stick" predates this refusal.

### `GET /inventory/itemnames`

Two callers:
- `src/sprite-tools/names.mjs`, by hand, for the vanilla `items` table.
- **(tML) `server-manager`'s `GET /server/{id}/items/names`**, when an operator opens the item rules editor on a tModLoader server. It reads only `modItems` and ignores `items`. This is on demand, not polled, but it does go through `tshock-proxy` from a lambda, so the whole response must stay well under a few MB.

The response is `{ "status": "200", "version": "<Terraria version>", "count": n, "items": { "<netId>": "<name>", … } }`. It includes negative ids.
- **It must answer with nobody online.** It reads only tables that are fixed after startup, so it runs off the main thread.
- **(tML extension)** `modItems`: `{ "<itemKey>": "<name>" }` for every loaded modded item, alongside `items` for vanilla. Modded items are not in `items`, because their `netId`s aren't stable keys.

### Not used by the backend

These are served by the TShock plugin but no backend code calls them:
- `/inventory/removeitem`
- `/inventory/snapshot` (a single snapshot by id)
- snapshot `from`/`to`/`meta`

Implementing them on tML is optional.

## Changelog

- **1.1:** `itemKey` on slot entries; `modItems` on `itemnames`; `account: null` and `group: ""` allowed; the planned mod accessory slot extension noted.
- **1.0:** the TShock plugin as of 2026-09.
