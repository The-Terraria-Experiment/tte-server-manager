# Contract: server control REST API

`contractVersion`: **1.1**
- 1.0 is the TShock baseline: exactly what TShock serves today.
- 1.1 adds the **(tML extension)** fields and endpoints.

The backend controls a running game server entirely through this API. On TShock it is TShock's own
REST server. On tModLoader it is served by the `TteControl` mod (`tml-tte-control`), which
reproduces the subset below *exactly*. Endpoint paths, parameter names, response keys and even the
string-typed `status` all match. That is what lets `tshock-proxy`, `TShockAPI` and every caller work
unchanged on both server types.

Only what the backend actually sends or reads is listed here. TShock serves much more, and none of
the rest is part of the contract.

## Transport

- **Caller:** the `tshock-proxy` lambda (`src/lambda/tshock-proxy`, HTTP code in `_shared/shared/utils/tshock/TShockDirect.ts`), from inside the VPC, dialling the instance's **private IP**.
- **Port:** `TSHOCK_API_PORT` (3891 on the fleet). The security group only admits the proxy's security group, and the listener has no other network protection. Implementations may bind `0.0.0.0` but must not assume a trusted network beyond that.
- **Plain HTTP, and every call is a `GET` with all parameters in the query string.** Mutations are GETs too; that is TShock's convention and the proxy always sends it that way. Parameter values arrive URL-encoded, and booleans arrive as the strings `true` and `false`.
- **Timeout:** 5s per request, token mint included. A handler that can take longer (the world save in `/v2/server/off`) must answer first and do the work afterwards.
- **Response:** `application/json`, always an object.

### Server not running = connection refused

The backend reads **`ECONNREFUSED` as "the game server is not running"**. That is an ordinary state, not an error, and it drives:
- the "offline" tile
- auto-shutoff's liveness checks
- the shutdown job's decision whether there is a server to save

Implementations must therefore:
- **not accept connections until the world is loaded and the server is accepting players.** A listener that answers during worldgen or mod loading would report a server that can't be joined.
- **close the listener as part of exiting.** A listener that outlives the game loop would answer for a dead server.

## Auth

`GET /v2/token/create?username=<u>&password=<p>` returns `{ "status": "200", "token": "<opaque>" }`.

- **Credential source:** the pair comes from the Secrets Manager secret `TSHOCK_SECRET_NAME` (`TSHOCK_USER`/`TSHOCK_PASSWORD`), one value for the whole fleet.
  - TShock checks it against its user table (`setup.sh` creates the account).
  - `TteControl` checks it against the **credential file** named by `TTE_CONTROL_CREDENTIAL_FILE` (see "Launch-time environment" below), which `setup.sh` writes.
- **Every other endpoint requires `token=<token>`** in the query string.
- **Rejecting a token:** respond **HTTP 403 *and* `"status": "403"`** in the body. The proxy treats either one (or a 401) as "re-mint and retry once" (`isTokenRejection`).
- **Tokens never expire on a timer.** The proxy caches them for the life of its container. A token only has to stop working when the server process restarts. Keeping tokens in memory only gets this for free.
- **Never log the query string of `/v2/token/create`.**

## Response envelope

- **Success:** HTTP 200 and a body with **`"status": "200"` as a string**. Two things compare against that string literally: `String(raw.status) !== "200"` in `getFleetOverview`, and `serverStore`'s online check. A number `200` works only by accident of `String()`; emit the string.
- **Failure:**
  - HTTP 4xx/5xx with a body of `{ "status": "<code>", "error": "<human message>" }`.
  - Also set **`message`** to the same text, because the proxy builds its error from `json.message` and falls back to a generic "TShock API error" without it.
  - A **200 response carrying `error`** is also treated as a failure by the inventory paths, but don't rely on that elsewhere.

## Endpoints

### `GET /v2/server/status`

| Param | Meaning |
|---|---|
| `players=true` | include `players` |
| `rules=true` | include `rules` |

Response fields the backend and UI read (all at top level):

| Field | Type | Notes |
|---|---|---|
| `status` | `"200"` | see envelope |
| `name` | string | server name |
| `world` | string | world name, shown as the tile headline |
| `port` | number | game port |
| `playercount` | number | auto-shutoff reads this (falling back to `players.length`) to confirm the server is empty before stopping it |
| `maxplayers` | number | |
| `uptime` | string | `d.hh:mm:ss` |
| `serverversion` | string | Terraria version, shown as "Terraria Version" |
| `tshockversion` | string | TShock only; tML omits it |
| `serverpassword` | any | rendered verbatim. TShock reports whether one is set. **Never the password itself** |
| `players` | array | when `players=true`. Only **`nickname`** is read (roster chips, fleet roster, inventory cache eviction). TShock also sends `username`, `group`, `active`, `state` and `team`; extras are ignored |
| `rules` | object | when `rules=true`. Arbitrary `key → scalar` map rendered as a grid. Any keys are fine |

**(tML extension)** fields:

| Field | Type | Notes |
|---|---|---|
| `serverType` | `"tmodloader"` | absent means TShock |
| `tmodloaderversion` | string | replaces `tshockversion` |
| `mods` | `{ name, displayName, version }[]` | mods **loaded in this process**. Not the same as "enabled" (see `/tte/mods`) |
| `contractVersions` | `{ "control-rest": "1.1", "inventory-monitor"?: "…" }` | each mod adds its own entry |

The status endpoint is polled continuously by every open browser (through `tshock-proxy`), so it must stay cheap. Don't compute anything per call that can be cached.

**It must answer with nobody online.** Auto-shutoff calls it exactly when the server is empty. See "Main thread" below.

### `GET /v2/server/off`

| Param | Meaning |
|---|---|
| `confirm=true` | required. Refuse without it |
| `message` | shown to players as they are disconnected |

This is the **only graceful stop the backend has**, and three callers rely on it:
- the Stop button (`server-manager/actions/stop.ts`)
- the auto-shutoff countdown
- the first task of every instance shutdown (`TShockServerStop.ts`)

Requirements:
1. Answer `{ "status": "200" }` **before** doing the slow part, because of the 5s timeout.
2. Then **save the world** (on tML that is both `.wld` and `.twld`), disconnect players with `message`, and **exit the process**.
3. **The process must be gone within ~50s.** The shutdown job then polls `pgrep -f` on the box for the process to disappear and gives up at the end of a 60s task budget. After that, `syncing-files` uploads whatever is on disk. A world that is still being written when that happens is uploaded half-written.

Why the order matters: Terraria only writes the world on save. A stop that exits without saving loses everything since the last autosave, and the sync behind it then overwrites the good copy in S3.

### `GET /v2/server/broadcast`

`msg` is shown to every player. Auto-shutoff uses it for its 10, 5 and 2 minute warnings. The response is `{ "status": "200" }`.

### `GET /v3/server/rawcmd`

`cmd` is a console command line. On TShock it has a leading `/`; tML console commands have none, and implementations should accept both.

The response is `{ "status": "200", "response": ["line", …] }`. `response` must be an **array of strings**, because the UI renders `response.join("<br/>")`. Capture the command's output into it; don't just acknowledge.

### `GET /v3/server/reload`

On TShock this reloads `config.json`.
- On tML, reload whatever `TteControl` itself owns: its config and the ban store.
- `serverconfig.txt` is launch-time only and can't be reloaded. The backend does not call this for tML instances. Answer `{ "status": "200" }` anyway, so a stray call is harmless.

### `GET /v4/players/read`

`player` is a player name.

The response is the player object at top level. The backend reads only these fields, to build ban identifiers:

| Field | Notes |
|---|---|
| `nickname` | in-game name |
| `username` | TShock account name. tML: `""` (there are no accounts) |
| `ip` | IPv4 without port |

An unknown player is a failure (see envelope). Other TShock fields (`group`, `muted`, `position`, `items`, `buffs`, `registered`) are logged but not read.

### `GET /v2/players/kick`

| Param | Meaning |
|---|---|
| `player` | player name |
| `reason` | shown to the player |

The response is `{ "status": "200" }`. A player who is not online is a failure. Automatic item-rule enforcement records that honestly rather than as a kick.

### `GET /v2/players/kill`

`player`, and `from` (the death message source). The response is `{ "status": "200" }`.

### `GET /v2/players/mute`

`player`. The response is `{ "status": "200" }`. The muted player's chat is dropped server-side for the rest of their session.

### Bans

**`GET /v3/bans/create`**

| Param | Format |
|---|---|
| `identifier` | `<prefix>:<value>`, with prefix `acc`, `uuid`, `name` or `ip` |
| `reason` | string |
| `start` | optional. `YYYY-MM-DD HH:MM:SS`, no timezone |
| `end` | optional. Same format; absent means permanent |

- **Identifiers:** the backend sends several identifiers per ban, one call each: `acc:<username>`, `uuid:<username>` (a long-standing quirk), `name:<nickname>`, and `ip:<ip>` when an IP ban was requested.
  - **Store every identifier as given, and enforce `name:`, `ip:` and `uuid:` on join.**
  - `acc:` has no meaning on tML. Store it, and treat it as a `name:` match.
  - Duplicate identifiers must not fail.
- **Timezone:** parse `start` and `end` as **server-local time** (UTC on the fleet), as TShock does.

The response is `{ "status": "200" }`. TShock is known to return a 500 here while still creating the ban, and the backend tolerates exactly that. **Don't copy it.**

**`GET /v3/bans/list`**

The response is `{ "status": "200", "bans": [ … ] }`, with each ban shaped as follows:

| Field | Notes |
|---|---|
| `ticket_number` | number, unique, stable |
| `identifier` | as created |
| `reason` | string |
| `banning_user` | string. tML: the operator name from the backend isn't passed through, so use `"ttesm"` |
| `start_date_ticks` | .NET `DateTime.Ticks` as a **number or numeric string** (the UI reads `BigInt(String(v))`) |
| `end_date_ticks` | same, and `3155378975999999999` (`DateTime.MaxValue`) for permanent |

**`GET /v3/bans/destroy`**

| Param | Meaning |
|---|---|
| `ticketNumber` | the ban to remove |
| `fullDelete` | `true` deletes the record; `false` expires it now and keeps it for history |

The response is `{ "status": "200" }`.

### `GET /tte/mods` (tML extension)

The response is `{ "status": "200", "mods": [ { "name", "displayName", "version", "enabled", "loaded" } ] }`.
- **What's listed:** every `.tmod` in the server's `Mods/` folder.
- `enabled` comes from `Mods/enabled.json`, which says what the **next** launch will load.
- `loaded` means the mod is in this process now.

The two differ right after a toggle, and the UI must show both.

### `GET /tte/mods/enabled` (tML extension)

| Param | Meaning |
|---|---|
| `mod` | internal mod name |
| `enabled` | `true` or `false` |

This rewrites `Mods/enabled.json`, and the change **takes effect on the next launch**. The response is the same as `/tte/mods`.
- Refuse to disable `TteControl` itself; that would make the server unmanageable after the next launch.
- An unknown mod name is a failure.

## Launch-time environment (tML extension)

The backend launches tModLoader through `systemd-run` (`_shared/shared/utils/tshock/TModLoaderLaunch.ts`)
and passes two things to TteControl as **environment variables on the server process**.

### `TTE_CONTROL_CREDENTIAL_FILE`

This is always set. Its value is an absolute path, currently `/etc/tte/tte-control-credential.json`.
- **Contents:** `{ "username": "…", "password": "…" }`, UTF-8 JSON, written by `setup.sh`. The file is `0640 root:<server user>`.
- **It is the source of the `/v2/token/create` credential.** Read it when the listener opens, which picks up a rotation at the next world load. If the variable is unset, or the file is missing, unreadable, malformed, or has an empty field, **refuse every login** and log why once, without the file's contents.
- **Why it isn't in a `ModConfig`:** `ModConfigs/` is under the save directory, and the backend exposes that directory in the Instance Files browser so mod configs can be edited. Anything there can be read and downloaded by operators with file access, and a download copies it into the S3 filestore. The file above sits outside every browsable path.
- **Never log the password.** Never put it in a response or echo it from a command.

### `TTE_WORLD_EVIL`

This is set only when the backend launches an `-autocreate` run. Its value is `random`, `corrupt` or `crimson`.
- **Why it exists:** vanilla has no world-evil option for autocreate, and the server's create flow has no world-evil input. The backend's create form offers the choice, so TteControl applies it.
- **What to do with it:** apply it to `WorldGen.WorldGenParam_Evil` before generation decides the evil: `corrupt` → `0`, `crimson` → `1`, `random` → `-1`. The obvious place is a `ModSystem.PreWorldGen` override. **Verify that the dedicated server's autocreate path doesn't reset the parameter after that hook runs.** If it does, use a `ModifyWorldGenTasks` pass inserted before the evil is chosen instead.
- **Absent or unrecognised:** leave generation alone, which means random.
- **Scope:** only an autocreate run reads it. Loading an existing world never generates, so the variable is irrelevant there.

Difficulty, the password, port and max players do **not** travel this way. Difficulty and password go through `serverconfig.txt` (`difficulty=`, `password=`), and port and max players go on the command line. Those are vanilla mechanisms that need nothing from the mod.

## Main thread (implementation requirement, tML)

Terraria's world and player state are not thread-safe, and the REST listener runs off the main thread. Every handler that reads or mutates game state must marshal onto the game loop and wait for the result there. That covers status players, off, broadcast, rawcmd, players and kick. The inventory plugin's `MainThreadDispatcher` is the reference implementation, including its timeout guard.

**Trap:** the inventory plugin documents that *an empty server stops pumping the game loop*, so main-thread work queued on an empty server times out. Status, off and broadcast are called by auto-shutoff **precisely when the server is empty**. Implementations must make those three work with nobody online. Either confirm that the tML dedicated-server loop keeps ticking when empty, or serve them from state that is safe to read off-thread. Verify this before anything else, because failing here means auto-shutoff can never stop a tML server.

## Changelog

- **1.1:** the tML extension fields on `/v2/server/status`; `/tte/mods` and `/tte/mods/enabled`; `contractVersions`; the launch-time environment (`TTE_CONTROL_CREDENTIAL_FILE`, `TTE_WORLD_EVIL`).
- **1.0:** the TShock baseline, documented from the backend's usage as of 2026-09.
