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

- **Owner card**: readable by anyone who taps the stone ("belongs to…, if found contact…").
- **Password (optional)**: track keys are wrapped a second time with a key derived from the password (PBKDF2-SHA256, 600,000 rounds). The hint stays readable.
- **Date windows**: one-off (`2026-12-24 → 2026-12-26`) or every year (`12-20..12-27`, may wrap the new year). This is about discovery, not security: it follows the phone's clock.
- **Adding messages later**: new audio is uploaded and the header rewritten. The stone is never rewritten.

All of this lives in [`shared/format.js`](shared/format.js), which both apps import.

## Layout

```
shared/   format.js (crypto + format), r2.js (storage), config.js, base.css
writer/   make and edit pebbbles — Android Chrome for NFC; any browser with a pasted link
player/   open and play — any phone
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

In [`shared/config.js`](shared/config.js), replace `https://pub-073de7a826d54d4490642e8ce5e90072.r2.dev` with your bucket's public URL.

### 3. GitHub Pages

Repo → Settings → Pages → Deploy from branch `main`, folder `/ (root)`.

- Writer: `https://msieur-gab.github.io/Pebbble-V2/writer/`
- Player: `https://msieur-gab.github.io/Pebbble-V2/player/`

## Before writing real stones

The player's address is written onto every stone and can't change afterwards. `github.io` and `r2.dev` are fine for testing. For stones you give away, put a domain you own in front of the player first. The R2 address doesn't matter as much, because it lives in `config.js` and can be changed at any time.

## Not in this core yet

- Owned-device offline library. The player currently keeps everything in memory, which is the not-owned behaviour.
- Full player UI from v1 (Lit components, sleep timer, i18n).
- Tag locking, and re-sealing v1 stones.
