// Pebbble v2 format — shared by writer and player.
//
// Tag URL:  <appBase>#<id>.<key>
//   id  = 12 random bytes (base64url) — names the pebbble's folder in storage
//   key = 32 random bytes (base64url) — opens the header; never sent to a server
//
// Storage:  <id>/header      AES-256-GCM(tagKey, headerJSON), AAD = "pebbble/v2/header/<id>"
//           <id>/<file>      AES-256-GCM(trackKey, audio),    AAD = "pebbble/v2/track/<id>/<file>"
// Every sealed blob is nonce(12) || ciphertext+tag.

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export const VERSION = 2;
const PBKDF2_ROUNDS = 600_000;

// ---------- bytes ----------

export const b64u = {
    enc(bytes) {
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    dec(str) {
        const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from(s, c => c.charCodeAt(0));
    },
};

export const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));
export const newFileName = () => b64u.enc(randomBytes(9));

// ---------- identity ----------

export function newPebbble() {
    return { id: b64u.enc(randomBytes(12)), key: b64u.enc(randomBytes(32)) };
}

export function tagUrl(appBase, { id, key }) {
    return `${appBase}#${id}.${key}`;
}

/** Parse "#<id>.<key>" (with or without #). Returns null when malformed. */
export function parseFragment(hash) {
    const m = /^#?([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/.exec(hash || '');
    return m ? { id: m[1], key: m[2] } : null;
}

// ---------- AES-GCM ----------

const aesKey = raw => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function seal(raw, plain, aad) {
    const iv = randomBytes(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, await aesKey(raw), plain);
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), 12);
    return out;
}

async function open(raw, sealed, aad) {
    const bytes = new Uint8Array(sealed);
    try {
        const pt = await subtle.decrypt(
            { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: te.encode(aad) },
            await aesKey(raw),
            bytes.subarray(12),
        );
        return new Uint8Array(pt);
    } catch {
        throw new Error('decrypt-failed');
    }
}

const headerAad = id => `pebbble/v2/header/${id}`;
const trackAad = (id, file) => `pebbble/v2/track/${id}/${file}`;
const wrapAad = (id, file) => `pebbble/v2/wrap/${id}/${file}`;
const checkAad = id => `pebbble/v2/pwcheck/${id}`;

// ---------- header ----------

/**
 * Header shape:
 * { v, name, cover?, owner: {name, contact}, hint?, pw?: {salt, rounds, check},
 *   tracks: [{ f, title, type, duration?, k? | wk?, window? }], updated }
 * A track carries `k` (its key) when there is no password, `wk` (its key wrapped
 * with the password key) when there is one.
 */
export function newHeader(owner, name = '') {
    return { v: VERSION, name, owner: { name: owner?.name || '', contact: owner?.contact || '' }, tracks: [], updated: Date.now() };
}

/** Seed for the pebbble's drawn cover: the pebbble id unless another stone was chosen. */
export const coverSeed = (header, id) => header.cover || id;
export const newCoverSeed = () => b64u.enc(randomBytes(9));

export async function sealHeader(header, { id, key }) {
    header.updated = Date.now();
    return seal(b64u.dec(key), te.encode(JSON.stringify(header)), headerAad(id));
}

export async function openHeader(sealed, { id, key }) {
    const header = JSON.parse(td.decode(await open(b64u.dec(key), sealed, headerAad(id))));
    if (header.v !== VERSION) throw new Error('unsupported-version');
    return header;
}

// ---------- tracks ----------

/** Encrypt audio with a fresh key. Returns { sealed, key } (key = raw bytes). */
export async function sealTrack(audio, id, file) {
    const key = randomBytes(32);
    return { sealed: await seal(key, audio, trackAad(id, file)), key };
}

export function openTrack(sealed, id, file, key) {
    return open(key, sealed, trackAad(id, file));
}

/** Add a track entry to the header. pwKey is required when the header has a password. */
export async function addTrack(header, id, { file, title, type, duration, window, key }, pwKey) {
    const entry = { f: file, title, type };
    if (duration) entry.duration = duration;
    if (window) entry.window = window;
    if (header.pw) {
        if (!pwKey) throw new Error('password-required');
        entry.wk = b64u.enc(await seal(pwKey, key, wrapAad(id, file)));
    } else {
        entry.k = b64u.enc(key);
    }
    header.tracks.push(entry);
    return entry;
}

/** Raw key for a track. */
export async function trackKey(track, id, pwKey) {
    if (track.k) return b64u.dec(track.k);
    if (!pwKey) throw new Error('password-required');
    return open(pwKey, b64u.dec(track.wk), wrapAad(id, track.f));
}

// ---------- password ----------

/**
 * Forgiving form of a password: capitals, spaces around and doubled inside, and accents
 * on Latin letters don't matter ("Rivière " = "riviere"). Symbols and digits stay exact.
 */
export function relaxPassword(password) {
    return password.normalize('NFD')
        .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
        .normalize('NFC')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

async function derivePwKey(password, salt, rounds) {
    const base = await subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, base, 256);
    return new Uint8Array(bits);
}

/** Put a password on a header that has none yet. Moves every track key under it. Returns pwKey. */
export async function setPassword(header, id, password, hint = '') {
    if (header.pw) throw new Error('already-protected');
    const salt = randomBytes(16);
    const pwKey = await derivePwKey(relaxPassword(password), salt, PBKDF2_ROUNDS);
    header.pw = {
        relaxed: true, // older pebbbles lack this and keep exact matching
        salt: b64u.enc(salt),
        rounds: PBKDF2_ROUNDS,
        check: b64u.enc(await seal(pwKey, te.encode('ok'), checkAad(id))),
    };
    header.hint = hint;
    for (const t of header.tracks) {
        t.wk = b64u.enc(await seal(pwKey, b64u.dec(t.k), wrapAad(id, t.f)));
        delete t.k;
    }
    return pwKey;
}

/**
 * Take the password off: every track key goes back to plain `k` in the header.
 * Needs the current pwKey. Audio files are untouched.
 */
export async function removePassword(header, id, pwKey) {
    if (!header.pw) return;
    for (const t of header.tracks) {
        t.k = b64u.enc(await trackKey(t, id, pwKey));
        delete t.wk;
    }
    delete header.pw;
    delete header.hint;
}

/** New password (and hint) in place of the old one. Only the header changes. Returns the new pwKey. */
export async function changePassword(header, id, pwKey, password, hint = '') {
    await removePassword(header, id, pwKey);
    return setPassword(header, id, password, hint);
}

/** True when a remembered pwKey still opens this header (false after a password change). */
export async function pwKeyStillValid(header, id, pwKey) {
    if (!header.pw || !pwKey) return false;
    try { await open(pwKey, b64u.dec(header.pw.check), checkAad(id)); return true; } catch { return false; }
}

/** Returns pwKey, or throws 'wrong-password'. */
export async function unlock(header, id, password) {
    const { salt, rounds, check, relaxed } = header.pw;
    const pwKey = await derivePwKey(relaxed ? relaxPassword(password) : password, b64u.dec(salt), rounds);
    try {
        await open(pwKey, b64u.dec(check), checkAad(id));
    } catch {
        throw new Error('wrong-password');
    }
    return pwKey;
}

// ---------- date windows (discovery, not security: follows the phone's clock) ----------
// one-off: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }   (either may be omitted)
// yearly:  { every: 'MM-DD..MM-DD' }                   (may wrap the new year, e.g. '12-28..01-03')

const day = (y, m, d) => new Date(y, m - 1, d);
const ymd = s => s.split('-').map(Number);
const endOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/** { state: 'open' | 'locked' | 'past', opens?: Date, closes?: Date } */
export function windowStatus(window, now = new Date()) {
    if (!window) return { state: 'open' };

    if (window.every) {
        const [a, b] = window.every.split('..');
        const [am, ad] = ymd(a);
        const [bm, bd] = ymd(b);
        const wraps = bm < am || (bm === am && bd < ad);
        const y = now.getFullYear();
        // Occurrences starting last year, this year and next year cover every case.
        for (const start of [y - 1, y, y + 1]) {
            const opens = day(start, am, ad);
            const closes = endOf(day(wraps ? start + 1 : start, bm, bd));
            if (now >= opens && now <= closes) return { state: 'open', opens, closes };
            if (now < opens) return { state: 'locked', opens };
        }
    }

    const opens = window.from ? day(...ymd(window.from)) : null;
    const closes = window.to ? endOf(day(...ymd(window.to))) : null;
    if (opens && now < opens) return { state: 'locked', opens };
    if (closes && now > closes) return { state: 'past', closes };
    return { state: 'open', ...(closes && { closes }) };
}

// ---------- writer library (the creator's list of pebbbles) ----------
// One encrypted file per creator: _library/<libId>. Both libId and the key come
// from a passphrase, so any device with the passphrase finds and opens the same list.
// { v: 1, items: [{ id, key, name, cover, owner, count, updated }] }

const libAad = libId => `pebbble/v2/library/${libId}`;

/** Passphrase → { libId, libKey } (base64url). Salted per bucket. */
export async function deriveLibrary(passphrase, bucket) {
    const base = await subtle.importKey('raw', te.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(`pebbble/v2/library/${bucket}`), iterations: PBKDF2_ROUNDS }, base, 384));
    return { libId: b64u.enc(bits.subarray(32)), libKey: b64u.enc(bits.subarray(0, 32)) };
}

export const newLibrary = () => ({ v: 1, items: [] });

export function sealLibrary(lib, { libId, libKey }) {
    return seal(b64u.dec(libKey), te.encode(JSON.stringify(lib)), libAad(libId));
}

export async function openLibrary(sealed, { libId, libKey }) {
    return JSON.parse(td.decode(await open(b64u.dec(libKey), sealed, libAad(libId))));
}

/** Insert or update one pebbble in the list, newest first. */
export function upsertLibrary(lib, entry) {
    lib.items = [entry, ...lib.items.filter(i => i.id !== entry.id)];
    return lib;
}
