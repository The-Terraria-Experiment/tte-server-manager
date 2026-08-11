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
npm run upload    # -> s3://$SPRITE_BUCKET/sprites/items/<version>/

# or all three
npm run all
```

Then point the frontend at the new version — `VITE_SPRITE_BASE_URL` and `VITE_SPRITE_VERSION` in
`src/tte-server-manager/.env*`. `upload.mjs` prints both.

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

Attach a CloudFront **response headers policy** with CORS to the behavior.
`Access-Control-Allow-Origin: *` is the right call here — the atlas is public game art, and `*` means
the response does not vary by origin, so `Origin` stays out of the cache key. Restricting it to the
app origins instead means adding `Origin` to the cache key, or one origin's cached response gets
served to another.

---

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
4. Update `VITE_SPRITE_VERSION` in the frontend `.env` files and deploy.

Old atlas versions can stay in the bucket indefinitely — they're ~1 MB each and keeping them means a
frontend rollback doesn't 404.
