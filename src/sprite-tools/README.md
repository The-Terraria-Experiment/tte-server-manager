# Terraria sprite pipeline

Rips Terraria's item sprites into a single atlas and publishes it to S3, so the web UI can draw a
player's inventory. **Manual, run by hand** — like `instance-scripts/`, nothing in this repo builds or
deploys it. Terraria releases are infrequent enough that automating it isn't worth the cost (see
"Why not CI" below).

Output is one PNG plus one coordinate JSON, keyed by ItemID. As of Terraria **1.4.5.6**: 6,085 items,
packed to 2048×2452, **1.16 MB**.

---

## Prerequisites

- **Node 18+** and `npm install` in this directory.
- **A local install of Terraria.** The sprites come from `Content/Images/Item_*.xnb` in the retail
  game. The scripts auto-detect a Steam install by reading `libraryfolders.vdf` across all drives;
  set `TERRARIA_CONTENT` if that fails.
- **AWS credentials** in the environment for the upload step only.

> **You cannot get these files from the dedicated server, and you cannot get them anonymously.**
> The free dedicated server download ships no `Content/` folder at all. And SteamCMD's
> `+login anonymous` does not work for Terraria — app 105600 has no `anonymoususer` flag and none of
> its depots (105601 Windows / 105602 Linux / 105603 macOS) are marked free, so an anonymous
> `app_update` returns `No subscription`. Downloading via SteamCMD requires an account that owns the
> game. Since you already own it, using the local install is strictly simpler.

## Running it

```bash
cd src/sprite-tools
npm install

npm run extract   # Content/Images/Item_*.xnb -> work/png/*.png + work/manifest.json
npm run pack      # -> work/atlas.png + work/atlas.json
npm run names     # -> work/names.json   (optional; needs a running server, see below)
npm run upload    # -> s3://$SPRITE_BUCKET/sprites/items/<version>/

# extract + pack + verify + upload (not `names` — that one needs a live server)
npm run all
```

Then point the frontend at the new version — `VITE_SPRITE_BASE_URL` and `VITE_SPRITE_VERSION`.
`upload.mjs` prints both. They have to be set in **two** places:

- **Local dev:** `src/tte-server-manager/.env.local`. Vite inlines these at build time, so the dev
  server needs a restart to pick up a change.
- **Stage and prod:** the Amplify Hosting app's environment variables, per branch. `.env.local` is
  gitignored and never reaches a deployed build — if only the local file is set, the site builds fine
  and silently renders item names instead of sprites.

Unset is a supported state (`spriteStore.isConfigured` goes false and slots fall back to item names),
which is convenient for local work but does mean a missing variable fails quietly rather than loudly.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `TERRARIA_CONTENT` | auto-detected from Steam | Path to `Content/Images` |
| `TERRARIA_VERSION` | read from `Terraria.exe` | Labels the atlas and the S3 prefix |
| `ATLAS_WIDTH` | `2048` | Atlas width; height grows to fit |
| `SPRITE_BUCKET` | `ttesm-sprites` | Upload target |
| `SPRITE_PREFIX` | `sprites/items` | Key prefix within the bucket |
| `AWS_REGION` | `us-east-2` | |

`work/` is gitignored — no game assets are committed. They're Re-Logic's, and the repo has no
business carrying 6,000 of them.

---

## What the scripts actually do

### `extract.mjs`

Decodes each `Item_<id>.xnb` to a PNG. The files are XNB v5, LZX-compressed, surface format Color
(RGBA8888). `Item_<N>` maps **1:1 to ItemID** — that's the whole reason this approach works.

Decoding uses the pure-JS [`xnb`](https://www.npmjs.com/package/xnb) package. TExtract (Java) and
TConvert (C#/WPF, Windows-only) are the better-known Terraria extractors and both work, but each
needs a runtime or a vendored binary; `xnb` is an `npm install` and decodes all 6,085 files with zero
failures. If it ever regresses, `TConvert-Console.exe -e -i <images> -o work/png -s` is a drop-in
replacement — the packer only wants a directory of `Item_<id>.png`.

Every run re-checks **premultiplied alpha** and reports the result. XNA's content pipeline normally
premultiplies, and no XNB→PNG extractor un-premultiplies on the way out, so this is worth watching.
Measured on 1.4.5.6 these assets are **not** premultiplied — 18k pixels carry a colour channel
greater than their alpha, which premultiplication makes impossible — so no colour correction is
applied. If a future release changes that, the run will say so.

### `pack.mjs`

Shelf-packs everything into one atlas and writes the coordinate map.

The interesting part is **animated items**. Terraria stores an animated item's sprite as a vertical
frame strip in a single file — `Item_75` (Fallen Star) is 22×208, eight 22×24 frames at a pitch of
26. Packed whole, those render as a tall smear in a square inventory slot. Nothing in the asset
records the frame count, so it's recovered structurally: Terraria pads each frame with two
transparent rows, so a strip is a height that divides into equal blocks where the last two rows of
*every* block are fully transparent and every block has content.

That test finds **102 items** on 1.4.5.6 and lands on exactly the ones that are animated in game —
the six Souls (520/521/547/548/549/575), the Fragments (3453–3455), torches, Fallen Star — with
frame counts of 3, 4, 8 and 9. Crucially it leaves tall-but-*static* items like spears alone, which a
naive aspect-ratio rule does not (1,070 sprites are taller than 1.5× their width; only ~100 are
strips). Because it's derived from the pixels, it re-derives itself on each Terraria release instead
of needing a hand-maintained list.

If it ever gets one wrong, `frameOverrides.json` maps `"<itemId>": <frameCount>` and takes priority.

### `upload.mjs`

Puts `atlas.png` and `atlas.json` at `sprites/items/<version>/` with
`Cache-Control: public, max-age=31536000, immutable`.

Keys are **immutable and version-scoped on purpose**. There is no `latest` pointer: a mutable key is
the one thing that would force the browser to revalidate a 1 MB image on every page load. Publishing
new sprites is a new prefix plus a frontend env change.

---

## Bucket setup (one-time)

**The bucket is private.** It is not public-read, and ACLs are not involved. CloudFront reads it
through an Origin Access Control (OAC); nothing else can. Three settings, all of which are the
default for a new bucket:

| Setting | Value | Why |
|---|---|---|
| Object Ownership | **ACLs disabled** (bucket owner enforced) | ACLs are the legacy mechanism. Access comes from the bucket policy; `upload.mjs` sets no ACL. |
| Block Public Access | **all four ON** | With OAC the bucket never needs to be public. |
| Bucket policy | the OAC policy below | Grants read to one CloudFront distribution and nothing else. |

### CloudFront + OAC

Create the distribution with the bucket as an S3 origin and pick **Origin access control settings**
(not "Public"). Create an OAC for it. CloudFront then shows the exact bucket policy with a *Copy
policy* button — paste it into **S3 → bucket → Permissions → Bucket policy → Edit**:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipalReadOnly",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::ttesm-sprites/sprites/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::<account-id>:distribution/<distribution-id>"
      }
    }
  }]
}
```

Scope the `Resource` to `sprites/*` rather than the whole bucket. The `AWS:SourceArn` condition is
what stops some *other* CloudFront distribution from using this bucket as its origin.

Don't be tempted to make the bucket public instead: it gains nothing, and it leaves the raw S3 URL
reachable so the CDN (and its cache headers) can be bypassed. If you do try it, the symptom is that
S3 **rejects the policy save outright** — Block Public Access's `BlockPublicPolicy` refuses to store
a policy granting public access, and `RestrictPublicBuckets` neuters one even if stored. Both have to
be turned off. With OAC you touch neither.

### CORS

`atlas.png` is loaded as a CSS `background-image` and needs no CORS. `atlas.json` is loaded with
`fetch()`, so it is a cross-origin request from the app domain to the CloudFront domain and the
browser blocks it without an `Access-Control-Allow-Origin` header.

**A response headers policy alone is not enough.** All three of these are required:

1. A **CORS configuration on the bucket** (`s3api put-bucket-cors`) — `GET`/`HEAD`, origins `*`.
2. The **`Managed-CORS-S3Origin` origin request policy** on the behavior, so CloudFront actually
   forwards `Origin` to S3 and S3 will emit the header.
3. The **`Managed-SimpleCORS` response headers policy** (already covered above) for ordinary cached
   hits. Its `OriginOverride` is false, so it defers to S3's header rather than duplicating it.

Why 1 and 2 matter: **CloudFront silently omits the response headers policy's CORS header on any
request that carries a cache-revalidation header** — `Cache-Control: no-cache`, `max-age=0`, or
`Pragma: no-cache` — even when the response is a cache hit. Chrome sends those on *every hard reload*.
With only the response headers policy, the atlas loads on a normal reload and fails on a hard one,
which is a maddening thing to debug because the natural reaction to a broken page is to hard reload.

Two traps worth internalising, both of which cost hours here:

- **`curl` with default flags sends no cache headers**, so it returns the header perfectly while the
  browser fails. Never conclude the CDN is fine until you have replayed the browser's *exact* request
  headers, cache directives included. Copy them from DevTools → Network → the failing request.
- **A response headers policy is not retroactive.** Objects already in the edge cache keep the headers
  they were cached with, so attaching a policy late fixes only what the edge fetches next — and with
  `immutable` plus a one-year max-age, "next" is effectively never. After any CDN change:

  ```bash
  aws cloudfront create-invalidation --distribution-id <id> --paths "/sprites/*"
  ```

Diagnose from **`Age` and `X-Amz-Cf-Pop`** on the failing response. If `Date - Age` predates your
config change, you are looking at a pre-change cached object and the fix is an invalidation. Note that
clearing the browser cache, incognito, and cache-busting query strings all change nothing when the
stale copy is at the CDN — and a query string is *specifically* useless, since the cache policy is
Managed-CachingOptimized (`QueryStringBehavior: none`) so CloudFront ignores it entirely.

Attach a CloudFront **response headers policy** with CORS to the behavior.
`Access-Control-Allow-Origin: *` is the right call here — the atlas is public game art, and `*` means
the response does not vary by origin, so `Origin` stays out of the cache key. Restricting it to the
app origins instead means adding `Origin` to the cache key, or one origin's cached response gets
served to another.

---

## Item names (`names.mjs`)

The item rule editor searches items by name, so the pipeline also publishes
`names.json` — `{ version, names: { "3509": "Copper Pickaxe", ... } }` — beside the atlas, under the
same immutable version prefix. `spriteStore.loadItemNames()` fetches it lazily, and only that editor
ever asks for it.

**The names do not come from the game files, and cannot.** This was investigated properly; the finding
is recorded here so nobody spends the day on it twice.

The game ships no localization files on disk at all — `Content/` is `Fonts`, `Images`, `Sounds` and a
handful of XNBs. The strings live inside `Terraria.exe`, which is an ordinary un-obfuscated .NET
assembly (PE32, `v4.0.30319`, five metadata streams, ~40k readable names). Its embedded resources
include `Terraria.Localization.Content.en-US.Items.json` **as plain text**, and it really is the map
you'd want:

```json
"ItemName": { "CopperPickaxe": "Copper Pickaxe", "Mug": "Mug", ... }
```

The problem is the key. That JSON is keyed by *internal* name, and so is every other data resource in
the exe (the rarity table is `//ItemID\tRarityCategoryId` over `YellowPhasesaberOld`, not over
numbers). The id ↔ internal-name mapping only ever existed as `ItemID`'s `public const short` fields —
and **those are gone from the release build**. `ItemID` does not appear in the `#Strings` heap at all,
nor do `NPCID`, `TileID`, `ProjectileID` or `BuffID`; the small ID classes that carry non-const members
(`GoreID`, `WallID`, `MountID`, `PrefixID`) *are* present, as is the `Terraria.ID` namespace itself.
That is exactly the shape you'd expect from a trimmer: C# inlines `const` at every call site, so a
const-only class is dead metadata by the time the build finishes. No amount of metadata parsing gets
past that, and a vendored community id→name table would need re-vendoring every release — the exact
maintenance this pipeline exists to avoid.

So the map comes from a **running game server** instead. The InventoryMonitor plugin exposes
`GET /inventory/itemnames`, which is `Lang.GetItemNameValue(id)` over the id space — authoritative by
construction for whatever version that server runs.

```jsonc
// GET /inventory/itemnames?token=…   (permission: invmonitor.rest.itemnames)
{ "status": "200", "version": "1.4.5.6", "count": 5455,
  "items": { "-48": "…", "1": "Iron Pickaxe", "2": "Dirt Block", … } }
```

Negative ids are included on purpose — they address Terraria's legacy item variants, the plugin
reports them verbatim in inventories, and the rule list accepts them.

### Running it

The REST port is closed to everything outside the VPC (see the `tshock-proxy` notes in `CLAUDE.md`), so
a workstation usually cannot reach it. Two inputs, same output:

```bash
# 1. from a saved response — run the curl on the instance, copy the JSON back
curl -s "http://localhost:3891/inventory/itemnames?token=$TOKEN" > dump.json
npm run names -- --file dump.json

# 2. directly, when this machine can reach the server (on the box, or over a tunnel)
TSHOCK_REST_URL=http://localhost:3891 TSHOCK_REST_TOKEN=… npm run names
```

It refuses to write a map with fewer than 3,000 names rather than publishing a partial one — a
half-empty map still "works", and would leave the editor unable to find most items with nothing to
explain why. It also cross-checks against `work/atlas.json` and reports sprites with no name and named
ids with no sprite.

`npm run upload` then publishes `names.json` alongside the atlas **only if the versions match**, and
skips it with a note when the file is absent. It is deliberately *not* part of `npm run all`: that
sequence runs offline against the local game install, and this step needs a live server.

A sprite version published without a `names.json` is a supported state — the editor falls back to bare
item IDs and logs one line saying so.

## Why not CI

A GitHub Action would need the game's `Content/Images`, which means either committing Re-Logic's
assets to the repo or putting Steam credentials for an account that owns Terraria into Actions
secrets (anonymous SteamCMD does not work — see above). Both are worse than running three commands
locally once or twice a year.

## Updating after a Terraria release

1. Let Steam update the game.
2. `npm run all`
3. Check the run output: the decode failure count should be 0, the premultiply verdict unchanged, and
   the frame-strip count in the same ballpark (~100).
4. Once an instance is running the new version, `npm run names` and `npm run upload` again to publish
   the matching name map. Skipping this leaves the rule editor on bare IDs for that version.
5. Update `VITE_SPRITE_VERSION` in the frontend `.env` files and deploy.

Old atlas versions can stay in the bucket indefinitely — they're ~1 MB each and keeping them means a
frontend rollback doesn't 404.
