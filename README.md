# Pebbble v2

A handcrafted stone that carries voice messages. Tap it with a phone, iPhone or Android, and the messages play.

This repo is the v2 core: a minimal **writer** (make and edit pebbbles) and **player** (open and listen). It validates the storage and security model before the full player UI comes over from the v1 repo.

## How it works

The stone's NFC tag holds one link:

```
https://msieur-gab.github.io/Pebbble-V2/player/#<id>.<key>
```

- `id` names the pebbble's folder in storage. `key` opens its header.
- Both sit after `#`, so the browser never sends them to any server. The player removes them from the address bar as soon as it reads them.
- iPhones read the link in the background and open it in Safari. No app and no tag serial are needed, so every phone behaves the same.

Storage (Cloudflare R2) only ever holds encrypted files:

| File | Encrypted with | Holds |
| --- | --- | --- |
| `<id>/header` | the tag key | owner card, password hint, track list, one key per track, date windows |
| `<id>/<file>` | that track's own key | the audio |

- **Name and cover**: each pebbble has a name (like an album title) and a drawn stone from [`shared/cover.js`](shared/cover.js). The stone is generated from a seed (the pebbble id, or another one picked in the writer), so the same stone appears on every device and no image is stored.
- **Owner card**: readable by anyone who taps the stone ("belongs to…, if found contact…").
- **Password (optional)**: track keys are wrapped a second time with a key derived from the password (PBKDF2-SHA256, 600,000 rounds). The hint stays readable. Because the password only wraps these small keys, it can be added, changed or removed at any time by rewriting the header: recordings and the stone are untouched. An owned phone that remembered an old password asks again.
- **Date windows**: one-off (`2026-12-24 → 2026-12-26`) or every year (`12-20..12-27`, may wrap the new year). This is about discovery, not security: it follows the phone's clock.
- **Adding messages later**: new audio is uploaded and the header rewritten. The stone is never rewritten.
- **Owned or not-owned device**: asked once on each phone. *Owned* keeps the header, keys and audio in IndexedDB, so the pebbble opens offline and without retyping the password, and the player lists saved pebbbles when opened without a tap. *Not-owned* stores nothing; it's all gone when the page closes. Switching to not-owned wipes the device. The offline cache only holds the app's own files, never pebbble content.
- **My pebbbles (writer library)**: the creator's list of pebbbles (name, stone, key) is one encrypted file in the bucket, `_library/<id>`. Its location and key are both derived from a passphrase set in the writer's settings (PBKDF2, salted per bucket); the passphrase itself is never stored. Any device with the storage settings and the passphrase sees the same list. Opening a stone in the writer adds it to the list.
- **Tap to edit**: on a device where the writer library is open, the player shows *Edit* on the creator's own pebbbles and opens the writer on them. No link copying. Today the R2 token is the real edit right; a per-pebbble edit key comes with a future upload server.
- **Player**: a tap opens on the stone (arrival, with the owner note for finders), *Listen* asks once whether this is the owner's phone and for the password if any, then the first voice plays. Bottom-sheet player with mini player, repeat (off / all / this voice), sleep timer (15–60 min or end of voice), lock-screen controls with the stone as artwork. Sleeping voices show when they wake. Each pebbble has a menu: *Edit* (creator), *Forget on this phone* (owned), *Settings*.
- **Languages**: English, French, Spanish, Chinese (`shared/i18n/`), detected from the phone and changeable in settings.

All of this lives in [`shared/format.js`](shared/format.js), which both apps import.

## Layout

```
shared/   format.js (crypto + format), r2.js (storage), i18n.js + i18n/, config.js, base.css
writer/   make and edit pebbbles — Android Chrome for NFC; any browser with a pasted link
player/   open and play — any phone; player.js (flow + playback), player.css, library.js (owned-device storage), sw.js (offline app shell)
test/     unit tests, a local stand-in for R2, an end-to-end browser test
```

No build step and no runtime dependencies.

## Run locally

```sh
npm install          # test dependency only
npm test             # format + request-signing tests
npm run serve        # http://localhost:8787/writer/ — local server stands in for R2
npm run e2e          # full writer → player flow in headless Chromium (needs playwright)
```

## Set up for real

### 1. Cloudflare R2

1. **Create a bucket**, e.g. `pebbble`.
2. **Public access**: bucket → Settings → Public Development URL → Allow. Copy the `https://pub-….r2.dev` URL.
3. **CORS**: bucket → Settings → CORS policy:
   ```json
   [
     {
       "AllowedOrigins": ["https://msieur-gab.github.io", "http://localhost:8787"],
       "AllowedMethods": ["GET", "PUT", "DELETE"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
4. **API token**: R2 → Manage API tokens → Create. Choose *Object Read & Write*, limited to this bucket. Keep the Account ID, Access Key ID and Secret. They go into the writer's settings on your phone and are never committed.

### 2. Config

`publicBase` in [`shared/config.js`](shared/config.js) holds the bucket's public URL. Change it there if the bucket ever moves.

### 3. GitHub Pages

Repo → Settings → Pages → Deploy from branch `main`, folder `/ (root)`.

- Writer: `https://msieur-gab.github.io/Pebbble-V2/writer/`
- Player: `https://msieur-gab.github.io/Pebbble-V2/player/`

## Before writing real stones

The player's address is written onto every stone and can't change afterwards. `github.io` and `r2.dev` are fine for testing. For stones you give away, put a domain you own in front of the player first. The R2 address doesn't matter as much, because it lives in `config.js` and can be changed at any time.

## Not in this core yet

- Writer redesign (the player is done; [`prototype/`](prototype/) keeps the clickable flow it was built from).
- Per-pebbble edit keys, checked by a small upload server (needed before others can create pebbbles).
- Tag locking, and re-sealing v1 stones.
