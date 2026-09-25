# Game-server contracts

These documents are the wire contracts between the backend in this repo and the software running
**on the game-server instances**: TShock plugins today, and tModLoader mods as well. They exist
because both sides live in different repositories, and a mod that drifts from what the backend
expects breaks features quietly. A missing field reads as "Unknown", and a wrong status string reads
as "server offline".

**This repo owns them.** The backend is the consumer, and a consumer's expectations are what an
implementation has to satisfy. Every mod and plugin repo imports the relevant document from here
rather than keeping its own copy. When a change touches a contract, update the document here in the
same change as the backend.

| Document | Implemented by | Consumed by |
|---|---|---|
| [control-rest.md](control-rest.md) | TShock itself; `tml-tte-control` on tModLoader | `TShockAPI` → `tshock-proxy` (server-manager, auto-shutoff-manager, instance-manager) |
| [inventory-monitor.md](inventory-monitor.md) | [`tshock-inventory-monitor`](https://github.com/The-Terraria-Experiment/tshock-inventory-monitor); `tml-inventory-monitor` | server-manager inventory, item-rule and archive paths; `src/sprite-tools/names.mjs` |
| [event-push.md](event-push.md) | `tshock-event-notifier`; `tml-event-logger` | logs-manager `pushLog` |

## Versioning

Each document carries a `contractVersion` in `major.minor` form.

- **Minor:** an additive change. Examples are a new optional field, a new endpoint, or a new event type. Older implementations keep working, and the backend must treat anything new as optional.
- **Major:** a field is removed or renamed, or the meaning of an existing one changes. It needs a coordinated backend and mod release.

Implementations report the contract version they were built against:
- control-rest and inventory-monitor: in `/v2/server/status` as `contractVersions`.
- event-push: in the payload as `schemaVersion`.

TShock itself reports nothing, and a missing value means "the TShock baseline, 1.0".

Sections marked **(tML extension)** exist only on tModLoader implementations. TShock never serves
them, and the backend gates on `serverType`/capabilities before calling them.

## Conventions shared by all three

- **JSON key casing is not guaranteed.** TShock serializes plugin models in PascalCase, and some builds use camelCase. The backend reads both (`pick` in `_shared/shared/utils/tshock/InventoryReport.ts`). New implementations should emit **camelCase** for anything nested and the exact lowercase keys shown here at the top level.
- **Never log credentials.** The REST credential rides in a query string (`/v2/token/create`), and the push API key rides in a header. Neither may appear in a log line on either side.
