# Contract: server event push

`contractVersion`: **1.0**. This equals the payload's `schemaVersion`.

The game server pushes player and server events to the backend over HTTPS.
- **TShock:** implemented by `tshock-event-notifier`, from the platform-agnostic `EventNotifier.Core` library plus a TShock plugin adapter.
- **tModLoader:** implemented by `tml-event-logger`, which should reuse `EventNotifier.Core` rather than re-implement it (see "Implementation note" below).

**This feed is not optional on any server type.** Beyond the player log shown in the UI, it is the
only input to:

- **auto-shutoff idle detection.** `lastPlayerLogAt`/`lastPlayersActive` on `autoshutoff#<id>` are written *only* here. A server that never pushes is never considered idle and is never shut off.
- **live roster updates.** `player.join`/`player.leave` publish `server.players` over the WebSocket.
- **the item-rule scan wake-up.** `player.join`/`player.leave` invoke the inventory snapshot drain.

## Request

`POST {API base}/logging/{instanceId}/players/push`

| Header | Value |
|---|---|
| `x-api-key` | the API Gateway API key. The key's presence routes the request to logs-manager's automated handler; there is no Cognito auth |
| `Content-Type` | `application/json` |

`{instanceId}` is the EC2 instance ID (`i-…`). The configured endpoint URL is the full path with the ID already in it.

## Payload (`PayloadSchemaV1`, `_shared/shared/schema/LogsTable.ts`)

```jsonc
{
  "schemaVersion": "1.0",
  "eventType": "player.join",
  "occurredAtUtc": "2026-09-23T18:00:00.000+00:00",   // ISO-8601; becomes the row's sort key
  "correlationId": "ec377fc0ab7f468a84f6e374ef41fce8",
  "pluginVersion": "1.0.0",
  "playerDataSource": "live",                          // "live" | "cached" | "unknown"
  "server": {
    "name": "…", "worldName": "…",
    "activePlayers": 3,                                // active count at event time (informational)
    "maxSlots": 16,
    "version": "…"                                     // TShock version; tML: tModLoader version
  },
  "player": {
    "index": 5, "name": "Alice",
    "accountName": "alice",                            // tML: null
    "groupName": "default",                            // tML: null
    "ipAddress": "203.0.113.7",
    "isLoggedIn": true                                 // TShock account login; tML: false
  },
  "eventData": { }                                     // stored as-is in `additional`
}
```

| `eventType` | When | Required for |
|---|---|---|
| `player.join` | join sequence complete | idle detection, roster, scan |
| `player.leave` | disconnect | idle detection, roster, scan |
| `player.chat` | chat message | log only |
| `player.death` | player death | log only |
| `player.spawn` | spawn or respawn | log only |
| `world.save` | world saved | log only |
| `server.reload` | TShock reload | log only. tML has no equivalent, so don't send it |

**Every `player.*` event refreshes the idle timer**, not only joins and leaves.
- **Idle means "no `player.*` event for `AUTO_SHUTOFF_IDLE_MINUTES`"** (`getIdleStatus`). A server that has never pushed one has no `lastPlayerLogAt` and is **never** idle.
- Before acting, auto-shutoff confirms emptiness through the REST `/v2/server/status` player count, not through this feed.
- `server.activePlayers` is recorded as `lastPlayersActive` for display and diagnosis. Send the server's active player count at event time, as TShock's `GetActivePlayerCount()` does. It doesn't have to be exact on `player.leave`.

`player` and `server` may be partial on `player.leave` (the client is already gone), and the backend
reads them defensively. Use `playerDataSource` to say how trustworthy `player` is. With
`playerDataSource: "unknown"`, the backend may drop the row by configuration.

## Response and delivery

The response is `200 { "success": true }`, or `{ "success": true, "ignored": true }` when the row was intentionally dropped. Nothing else in it is meaningful.

- **Delivery is at-least-once, and retries are safe.** The row key is instance + `occurredAtUtc` in ms, so a retried payload with the same `occurredAtUtc` overwrites its own row. **Keep `occurredAtUtc` fixed across retries.** Regenerating it on retry creates duplicate rows.
- **Never block the game loop.** Enqueue from the hook and send from a background worker with a bounded queue, as `EventNotifier.Core`'s `NotificationDispatchQueue` does.
- **The API key is a secret.** Don't log it, and don't print it from any admin command.

## Implementation note (tML)

`EventNotifier.Core` (`TTE/tshock-event-notifier/src/EventNotifier.Core`) is the envelope, serializer, HTTP sender and dispatch queue, with no TShock dependency. tModLoader runs on **.NET 8** and the core currently targets `net9.0`. Multi-target it (`<TargetFrameworks>net8.0;net9.0</TargetFrameworks>`) and have the tML mod reference the `net8.0` build, so both adapters share one implementation of this contract.
- The mod ships the core DLL through tModLoader's `dllReferences` mechanism.
- If the core uses any .NET 9-only API, fix that in the core. **Don't fork it.**

## Changelog

- **1.0:** the TShock event notifier as of 2026-09; the tML field mappings above.
