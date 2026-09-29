# CLAUDE.md — Pebbble v2

Guidance for Claude Code working in this repository. Read this first; the README covers setup for humans.

## What Pebbble is

A handcrafted stone with an NFC tag. Tapping it with a phone plays the "voices" it holds: voice messages, recordings or music, grouped into one pebbble (like an album). Built by Gab, a designer and maker, originally for his two daughters. Tone: calm, organic, simple. **Simplicity over features**: no bloat; every addition must earn its place.

Two web apps, no build step, no runtime dependencies:
- **player/**: what anyone who taps a stone sees. The user-facing app; most design attention goes here.
- **writer/**: the creator's tool for making and editing pebbbles and writing tags. Works in any browser; writing and reading tags needs Chrome on Android (Web NFC).
- **shared/**: `format.js` (crypto and format), `r2.js` (storage), `cover.js` (stones), `i18n.js` + `i18n/`, and the design system both apps use: `ui.css` (tokens, buttons, fields, sheets, rows, toast) and `ui.js` (helpers, icons, the sheet stack, toast, the dedication line). App-specific styles stay in `player/player.css` and `writer/writer.css`. Put anything both apps show in the shared files, not in one app.

## Branches and hosting

- **`redesign`** is the live branch: GitHub Pages deploys from it (Gab switched Pages to it). Anything pushed here reaches real stones within about a minute. Only push once `npm test` and `npm run e2e` pass.
- `main` holds the pre-redesign core. Merge `redesign` into `main` when Gab says so.
- Player: `https://msieur-gab.github.io/Pebbble-V2/player/`, writer: `…/writer/`, flow prototype: `…/prototype/`.
- Storage: Cloudflare R2 bucket `pebbble`, public reads via `https://pub-073de7a826d54d4490642e8ce5e90072.r2.dev` (set in `shared/config.js`). Uploads are signed in the browser with an R2 API token that lives only in the writer's settings on Gab's devices, never in the repo.
- The old v1 repo (`msieur-gab/pebbble`, IPFS + serial-as-key) is reference only. Don't touch it.

## Working with Gab

- **Ask before changing behaviour he has seen or agreed on**, even when it looks like a cleanup: a password rule, a format detail, a flow step. Propose, wait for his yes, then build. (A silent "no backward compatibility" cleanup and a new three-word minimum once locked him out of his own pebbbles and list.)

## Commits

- **Never mention Claude in commit messages** (Gab's standing preference). No `Co-Authored-By: Claude` lines either.
- Author: `Gabriel Baude <baude.gabriel@gmail.com>` (`git -c user.name=… -c user.email=… commit`).
- Message style: a short imperative subject, then a blank line and a few bullets on what changed and why.

## Format and security model (shared/format.js)

- **No backward compatibility yet.** No pebbble has been given away, so when the format changes, change it cleanly: no legacy flags, fallbacks or migration code. Gab rewrites his own test stones. This rule ends the day the first stone is distributed.

- **Tag holds one URL**: `<appBase>#<id>.<key>`. `id` = 12 random bytes (base64url, 16 chars) naming the folder in R2; `key` = 32 random bytes (43 chars) that opens the header. Both sit after `#`, so they never reach a server; the player strips them from the address bar on load. Works on iPhone, whose background NFC reading opens the URL in Safari with no app and no serial access. About 90 characters, fits an NTAG213.
- **The NFC serial is NOT used.** It isn't secret (any phone reads it), it's guessable, and iPhone web pages can't read it. We discussed serial-as-id and serial-derived keys and rejected both. Don't reintroduce them.
- **R2 layout**: `<id>/header` = AES-256-GCM(tag key, JSON), AAD `pebbble/v2/header/<id>`; `<id>/<file>` = AES-GCM(per-track random key, audio), AAD binds id + file name. Blobs are `nonce(12) || ciphertext`.
- **Header JSON**: `{ v: 2, name, cover?, from, for, ded?, contact, hint?, pw?: {salt, rounds, check}, tracks: [{ f, title, type, duration, window?, k | wk }], updated }`. `from` made it, `for` is who it's for (optional), `contact` is shown to finders.
- **Dedication** (`dedication()` in ui.js): under the name, in the phrasing the creator picks per pebbble: "for Lina · from Papa" (default) or, with `ded: 'love'`, "made with love by Papa for Lina". A found stone "belongs to" `for`, else `from` (`belongsTo()`).
- **Password (optional)** only wraps the per-track keys (`wk`, via PBKDF2-SHA256 600k rounds); `pw.check` verifies it. So a password can be added, changed or removed by rewriting the header alone: audio and the stone are untouched. Owned phones remember `pwKey` and re-ask if `pwKeyStillValid` fails. Argon2 was rejected because it isn't built into browsers. Passwords always go through `relaxPassword()` (lowercase, trimmed, spaces collapsed, Latin accents removed: é = e, ñ = n; symbols and digits exact).
- **Date windows** are discovery, not security (they follow the phone's clock): "from a date" `{from: 'YYYY-MM-DD'}` (asleep until that day, then awake for good) or "every year" `{every: 'MM-DD..MM-DD'}`, which may wrap the new year. `windowStatus()` returns open / locked. There is deliberately no end date: Gab found one-off windows that close again pointless.
- **Cover**: `shared/cover.js` is Gab's linocut pebble generator, kept unchanged. The seed is `header.cover || id`, so the same stone renders on every device and nothing is stored. Default ink is dark; the apps are **light theme only** because the stones are black.
- **Writer library** ("My pebbbles"): one encrypted file `_library/<libId>`, entries `{ id, key, name, cover, for, count, updated }`; `libId` and `libKey` are derived from the **key phrase** (PBKDF2, salted per bucket). The phrase is never stored, only the derived keys. Read-modify-write on every change.
- **Setup code**: `pebbble-setup:<sealed>` carries the storage settings to another device, sealed with `setupKey` = PBKDF2(key phrase, fixed salt). The code alone opens nothing; the other device types the same key phrase. The writer keeps `setupKey` so Settings can show a code without asking for the phrase.
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
- Far-off wake dates show their year ("Wakes on 14 March 2038").

## Writer behaviour (writer/writer.js)

Designed from the clickable renderings in `prototype/writer.html` (Gab approved them); keep the two in step when the design changes.
- **First time on a device**: *Paste a setup code* or *Set up my storage* (a guided sheet: bucket, public r2.dev address + a CORS rule to paste, API token; the account ID is read from the S3 address). *Connect* checks both writing and public reading with a small `_check` file and says which step is wrong. Then the **key phrase** screen. A *new* phrase needs at least 12 characters, in any form (length over composition rules, as Gab agreed). An *existing* phrase is never refused for its length: after a setup code it must open that code, and on a device that knew the phrase before setup codes existed it must give the same `libId`. The key phrase is case-sensitive, unlike pebbble passwords.
- **My pebbbles**: a shelf of stones, a *New pebbble* tile, *Hold a stone to the back of the phone* (Web NFC scan) and *Open a pebbble by its link*. Without Web NFC the hint says so.
- **Editor**, one calm page: the stone (*Another stone*, on new and saved pebbbles alike: the seed lives in the header), the name, **From / For** fields with a live preview of what people see when they tap and the phrasing choice (*for · from* / *made with love*), the voices, then *Keeping it safe* (password + hint, if found) and, for saved pebbbles, *Write to another stone* and *Delete* (tap twice). A new pebbble starts with the last From and contact used on this device. The dock button saves: *Save and write to a stone* (new, with NFC), *Save* (new, no NFC: write it later from the phone), *Save changes*.
- **Voice sheet**: record (AAC/MP4 when supported), or choose a file; title; *Always / From a date / Every year* (day + month pickers). Durations are measured when a voice is added. Every voice can be **listened to** before deciding to keep it: a new one from memory, a saved one fetched and decrypted like the player does. Remove asks twice.
- **Keep design and build in step.** Before calling the writer done, walk through every scene of `prototype/writer.html` and check each validated control exists in the real app. (Another stone on saved pebbbles, the phrasing choice and listening to voices were once lost between renderings and code.)
- **Password sheet**: changes apply on save (`pwPlan`); the password only rewraps keys in the header.
- **Write**: hold the stone, then *“Name” is in the stone* with *Listen now*, *Copy its link*, and **Lock the tag** (asks for confirmation, then `makeReadOnly()`; can't be undone).
- **Settings**: language, storage (reopens the guide), *Set up another device* (the setup code), *Disconnect this device* (tap twice; stones keep working).
- Every writer string goes through `t()` under `writer.*` in the same four language files. French uses "tu", like the player.
- **Every password field has a show/hide eye** (`revealPasswords()` in ui.js, in both apps). Revealed fields hide again when their sheet closes.

## Hard-won lessons

- **Caching**: GitHub Pages sends `max-age=600`. The service worker (`player/sw.js`) is network-first with `cache: 'no-cache'`, installs with `cache: 'reload'`, and is registered with `updateViaCache: 'none'`. **Bump `CACHE` in sw.js and add new files to `SHELL`** when the player's files change, including `shared/ui.*` and the language files.
- The service worker must **never cache pebbble content**: R2 is cross-origin, and `/bucket/` (the local dev stand-in) is excluded explicitly. A not-owned phone must store nothing.
- **Chrome's password manager crashed the writer on Android** when password fields sat outside forms next to a name field. Keep fields in `<form autocomplete="off" onsubmit="return false">`, buttons `type="button"`, `data-lpignore`.
- `querySelector('div > div')` on a row matches the wrong element. Use explicit classes.
- Recording: prefer `audio/mp4` (AAC, plays on iPhone) when `MediaRecorder.isTypeSupported`, else the browser default. Durations are measured in the writer (`audioDuration`) when a voice is added.
- Autoplay: `audio.play()` without a user gesture rejects. Catch it and show "Tap play to listen".

## Testing

```sh
npm test                                        # unit: format, password, windows, library, setup code, R2 signing vs aws4, language files
npm run serve                                   # http://localhost:8787 (static + fake R2 at /bucket and /s3)
CHROMIUM=/opt/pw-browsers/chromium npm run e2e  # full writer→player flow in headless Chromium (needs playwright)
```
The e2e test covers: guided setup and key phrase, the editor (From/For preview, another stone, password, contact, three kinds of voices), writing and locking a tag (Web NFC is simulated), encryption at rest, arrival with the dedication, device question, password (wrong/right/changed/removed), autoplay, repeat, sleep, the drag-to-fold and mini-player swipe, not-owned stores nothing (IndexedDB and Cache Storage), owned keeps everything, offline replay, languages, opening a stone by tapping it in the writer, a second device joining with a setup code (and a wrong key phrase), Edit visibility, Forget, and deleting a pebbble. Extend it with every behaviour change. When checking visuals, screenshot with Playwright's `devices['Pixel 7']`.

## Open topics

- **Writer**: redesigned (Sep 29, 2026). Parked on purpose: a desktop/tablet layout (it works as a centred column for now); scanning a setup code as a QR (paste only for now); changing the key phrase (would move the library file).
- **Hint language**: the hint is written in the creator's language and never translated; solutions are under discussion (see the conversation notes Gab keeps).
- Threat model (agreed with Gab): possession of the stone = access; password and date locks strengthen it; date locks follow the phone's clock by design (working that out is part of growing up). Host, domain or web changes over decades are accepted as outside Pebbble's control; the encrypted files can be moved to any host, and only the tag address would need rewriting.
- Custom domain before giving stones away (the app URL is baked into every tag); tag locking option; upload server with edit keys if Pebbble ever becomes a service; a dark mode would need light-ink stones.
