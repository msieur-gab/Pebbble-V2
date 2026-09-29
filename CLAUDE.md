# CLAUDE.md — Pebbble v2

Guidance for Claude Code working in this repository. Read this first; the README covers setup for humans.

## What Pebbble is

A handcrafted stone with an NFC tag. Tapping it with a phone plays the "voices" it holds: voice messages, recordings or music, grouped into one pebbble (like an album). Built by Gab, a designer and maker, originally for his two daughters. Tone: calm, organic, simple. **Simplicity over features**: no bloat; every addition must earn its place.

Two web apps, no build step, no runtime dependencies:
- **player/**: what anyone who taps a stone sees. The user-facing app; most design attention goes here.
- **writer/**: the creator's tool for making and editing pebbbles and writing tags (Android Chrome, for Web NFC).

## Branches and hosting

- **`redesign`** is the live branch: GitHub Pages deploys from it (Gab switched Pages to it). Anything pushed here reaches real stones within about a minute. Only push once `npm test` and `npm run e2e` pass.
- `main` holds the pre-redesign core. Merge `redesign` into `main` when Gab says so.
- Player: `https://msieur-gab.github.io/Pebbble-V2/player/`, writer: `…/writer/`, flow prototype: `…/prototype/`.
- Storage: Cloudflare R2 bucket `pebbble`, public reads via `https://pub-073de7a826d54d4490642e8ce5e90072.r2.dev` (set in `shared/config.js`). Uploads are signed in the browser with an R2 API token that lives only in the writer's settings on Gab's devices, never in the repo.
- The old v1 repo (`msieur-gab/pebbble`, IPFS + serial-as-key) is reference only. Don't touch it.

## Commits

- **Never mention Claude in commit messages** (Gab's standing preference). No `Co-Authored-By: Claude` lines either.
- Author: `Gabriel Baude <baude.gabriel@gmail.com>` (`git -c user.name=… -c user.email=… commit`).
- Message style: a short imperative subject, then a blank line and a few bullets on what changed and why.

## Format and security model (shared/format.js)

- **No backward compatibility yet.** No pebbble has been given away, so when the format changes, change it cleanly: no legacy flags, fallbacks or migration code. Gab rewrites his own test stones. This rule ends the day the first stone is distributed.

- **Tag holds one URL**: `<appBase>#<id>.<key>`. `id` = 12 random bytes (base64url, 16 chars) naming the folder in R2; `key` = 32 random bytes (43 chars) that opens the header. Both sit after `#`, so they never reach a server; the player strips them from the address bar on load. Works on iPhone, whose background NFC reading opens the URL in Safari with no app and no serial access. About 90 characters, fits an NTAG213.
- **The NFC serial is NOT used.** It isn't secret (any phone reads it), it's guessable, and iPhone web pages can't read it. We discussed serial-as-id and serial-derived keys and rejected both. Don't reintroduce them.
- **R2 layout**: `<id>/header` = AES-256-GCM(tag key, JSON), AAD `pebbble/v2/header/<id>`; `<id>/<file>` = AES-GCM(per-track random key, audio), AAD binds id + file name. Blobs are `nonce(12) || ciphertext`.
- **Header JSON**: `{ v: 2, name, cover?, owner: {name, contact}, hint?, pw?: {salt, rounds, check}, tracks: [{ f, title, type, duration?, window?, k | wk }], updated }`.
- **Password (optional)** only wraps the per-track keys (`wk`, via PBKDF2-SHA256 600k rounds); `pw.check` verifies it. So a password can be added, changed or removed by rewriting the header alone: audio and the stone are untouched. Owned phones remember `pwKey` and re-ask if `pwKeyStillValid` fails. Argon2 was rejected because it isn't built into browsers. Passwords go through `relaxPassword()` (lowercase, trimmed, spaces collapsed, Latin accents removed: é = e, ñ = n; symbols and digits exact) when `pw.relaxed` is set, which every new or changed password gets. Older headers without the flag match exactly.
- **Date windows** are discovery, not security (they follow the phone's clock): one-off `{from, to}` or yearly `{every: 'MM-DD..MM-DD'}`, which may wrap the new year. `windowStatus()` returns open / locked / past.
- **Cover**: `shared/cover.js` is Gab's linocut pebble generator, kept unchanged. The seed is `header.cover || id`, so the same stone renders on every device and nothing is stored. Default ink is dark; the apps are **light theme only** because the stones are black.
- **Writer library** ("My pebbbles"): one encrypted file `_library/<libId>`; `libId` and `libKey` are derived from a passphrase (PBKDF2, salted per bucket). The passphrase is never stored, only the derived keys. Read-modify-write on every save.
- **Edit rights today** = holding the R2 token. Per-pebbble edit keys only make sense with a future upload server (a Cloudflare Worker); deliberately not built yet.

## Player behaviour (player/player.js)

- Opening from a tap → **arrival** screen (the stone, name, "N voices inside", owner note for finders; "Welcome back" when the phone already keeps this pebbble). *Listen* provides the user gesture browsers require before sound.
- First time on a phone: **"Is this your phone?"** sheet. *Owned* keeps the header, keys and audio in IndexedDB (`player/library.js`) and plays offline; *not owned* stores nothing, and switching to not-owned wipes the device. This owned/not-owned split is a core principle; keep it.
- **The pebbble is one sheet** (v1 model, which Gab prefers): stone, now playing, progress, controls, repeat (off/all/one), sleep timer (15/30/45/60 min, end of voice), then the voice list. Opening plays the first open voice automatically. The top is fixed and only the voice list scrolls; on long lists the stone shrinks (`.compact`) and only when the list overflows by more than 180px, to avoid flicker.
- **Gestures**: drag the sheet's top down to fold it into the mini player; on the mini player, swipe sideways for next/previous and swipe up or tap to unfold. The drag zone swallows the click that follows a drag; the drag state resets on the next tick (this bug has bitten once).
- Menu "···" on the sheet: *Edit this pebbble* (only when the pebbble is in this browser's writer library, `localStorage['pebbble-writer-library']`; it opens `../writer/#id.key`), *Forget on this phone* (owned phones, tap twice), *Settings*. Menu and settings stack over the sheet; the scrim closes only the top sheet.
- Wording: the content is **"voices"**; date-locked voices are **"sleeping"** and "wake" on a date. Four languages in `shared/i18n/{en,fr,es,zh}.json`. Every user-facing player string goes through `t()`, and all four files must keep identical keys.
- **Keeping voices on owned phones**: `keep()` calls `navigator.storage.persist()` so the browser doesn't evict saved voices. A gentle install card ("Keep Pebbble on this phone") appears on owned phones not yet running from the home screen: Android uses the captured `beforeinstallprompt`; iPhone (no prompt API) gets "Tap Share, then Add to Home Screen", which matters because Safari clears website storage after a few weeks without use unless the app is on the home screen. "Not now" hides it for 30 days. Never shown on not-owned phones.
- **App icon**: the stone drawn from the seed `"pebbble-1"` (Gab's pick), on the app grey `#ecebe7` (icon-192/512, maskable, apple-touch-icon; favicon is the stone alone, thumb detail). The manifest's background and theme colour are the same grey, so the Android splash screen is the stone on grey. Regenerate icons with the cover generator if the look changes.
- Settings shows a version label (`VERSION` in player.js). **Bump it with every player change** so Gab can tell which version his phone runs.

## Hard-won lessons

- **Caching**: GitHub Pages sends `max-age=600`. The service worker (`player/sw.js`) is network-first with `cache: 'no-cache'`, installs with `cache: 'reload'`, and is registered with `updateViaCache: 'none'`. **Bump `CACHE` in sw.js and add new files to `SHELL`** when the player's files change.
- The service worker must **never cache pebbble content**: R2 is cross-origin, and `/bucket/` (the local dev stand-in) is excluded explicitly. A not-owned phone must store nothing.
- **Chrome's password manager crashed the writer on Android** when password fields sat outside forms next to a name field. Keep fields in `<form autocomplete="off" onsubmit="return false">`, buttons `type="button"`, `data-lpignore`.
- `querySelector('div > div')` on a row matches the wrong element. Use explicit classes.
- Recording: prefer `audio/mp4` (AAC, plays on iPhone) when `MediaRecorder.isTypeSupported`, else the browser default. Durations are measured in the writer (`audioDuration`); older voices get measured when opened in the writer and saved on the next save.
- Autoplay: `audio.play()` without a user gesture rejects. Catch it and show "Tap play to listen".

## Testing

```sh
npm test                                        # unit: format, password, windows, library, R2 signing vs aws4
npm run serve                                   # http://localhost:8787 (static + fake R2 at /bucket and /s3)
CHROMIUM=/opt/pw-browsers/chromium npm run e2e  # full writer→player flow in headless Chromium (needs playwright)
```
The e2e test covers: encryption at rest, arrival, device question, password (wrong/right/changed/removed), autoplay, repeat, sleep, the drag-to-fold and mini-player swipe, not-owned stores nothing (IndexedDB and Cache Storage), owned keeps everything, offline replay, languages, the library across two devices, Edit visibility, and Forget. Extend it with every behaviour change. When checking visuals, screenshot with Playwright's `devices['Pixel 7']`.

## Open topics

- **Writer redesign**: still the plain early UI. Big friction: typing R2 account ID and keys by hand. Rethink setup for simplicity.
- **Hint language**: the hint is written in the creator's language and never translated; solutions are under discussion (see the conversation notes Gab keeps).
- Threat model (agreed with Gab): possession of the stone = access; password and date locks strengthen it; date locks follow the phone's clock by design (working that out is part of growing up). Host, domain or web changes over decades are accepted as outside Pebbble's control; the encrypted files can be moved to any host, and only the tag address would need rewriting.
- Custom domain before giving stones away (the app URL is baked into every tag); tag locking option; upload server with edit keys if Pebbble ever becomes a service; a dark mode would need light-ink stones.
