// Pebbble v2 player.
// Not-owned device: everything lives in memory and is gone when the page closes.
// Owned device: header, keys and audio are kept in IndexedDB for offline listening.
import * as F from '../shared/format.js';
import * as R2 from '../shared/r2.js';
import * as L from './library.js';
import { config } from '../shared/config.js';
import { pebbleCover } from '../shared/cover.js';
import { initI18n, setLanguage, language, LANGUAGES, t } from '../shared/i18n.js';

const $ = id => document.getElementById(id);
const SCREENS = ['empty', 'library', 'hero', 'owner', 'device', 'lock', 'list'];

// Current pebbble
let p = null, header = null, sealedHeader = null, pwKey = null, currentUrl = null;

function screens(...visible) {
    if (visible.includes('owner')) visible.push('hero'); // the pebbble's face shows whenever it is open
    for (const id of SCREENS) $(id).hidden = !visible.includes(id);
}

function status(text) {
    $('status').hidden = !text;
    $('status').textContent = text || '';
}

/** Read the key from the address, then remove it so it doesn't stay in history. */
function takeFragment() {
    const found = F.parseFragment(location.hash);
    if (found) history.replaceState(null, '', location.pathname + location.search);
    return found;
}

// ---------- home: nothing tapped ----------

async function home() {
    p = header = null;
    status('');
    const saved = L.isOwned() ? await L.listPebbbles() : [];
    if (!saved.length) { screens('empty'); return; }
    screens('library');
    $('lib-list').replaceChildren(...saved.sort((a, b) => b.savedAt - a.savedAt).map(rec => {
        const row = document.createElement('div');
        row.className = 'track';
        row.innerHTML = '<div class="lib-name"><div class="cover thumb"></div><div><div class="title"></div><div class="muted"></div></div></div><div class="row"><button type="button" class="quiet"></button><button type="button"></button></div>';
        row.querySelector('.thumb').innerHTML = pebbleCover(rec.cover || rec.id, { detail: 'thumb', ink: 'currentColor' });
        row.querySelector('.title').textContent = rec.title || rec.name || t('owner.someone');
        row.querySelector('.muted').textContent = t('library.count', { count: rec.count });
        const [forget, open] = row.querySelectorAll('button');
        forget.textContent = t('library.forget');
        forget.onclick = async () => { if (confirm(t('library.forgetConfirm'))) { await L.forget(rec.id); home(); } };
        open.textContent = t('player.play');
        open.onclick = () => load({ id: rec.id, key: rec.key });
        return row;
    }));
}

// ---------- opening a pebbble ----------

async function load(found) {
    p = found; header = null; sealedHeader = null; pwKey = null;
    screens();
    status(t('player.opening'));

    const cached = L.isOwned() ? await L.getPebbble(p.id) : null;
    const usable = cached && cached.key === p.key ? cached : null; // a rewritten stone brings a new key

    let offline = false;
    try {
        sealedHeader = await R2.get(config.publicBase, `${p.id}/header`, { fresh: true });
        if (!sealedHeader) { status(t('player.empty')); return; }
    } catch {
        if (!usable) { status(t('player.cannotOpen')); return; }
        sealedHeader = usable.header;
        offline = true;
    }
    try {
        header = await F.openHeader(sealedHeader, p);
    } catch {
        status(t('player.cannotOpen'));
        return;
    }
    if (usable?.pwKey && header.pw) pwKey = usable.pwKey;

    status(offline ? t('player.offline') : '');
    renderOwner();
    if (!L.getMode()) askDevice();
    else next();
}

function next() {
    if (header.pw && !pwKey) {
        $('hint').textContent = header.hint || t('lock.noHint');
        screens('owner', 'lock');
        return;
    }
    screens('owner', 'list');
    renderTracks();
    if (L.isOwned()) keep();
}

function renderOwner() {
    $('cover').innerHTML = pebbleCover(F.coverSeed(header, p.id), { ink: 'currentColor' });
    $('pebbble-name').textContent = header.name || '';
    $('pebbble-name').hidden = !header.name;
    const { name, contact } = header.owner;
    $('owner-name').textContent = name || t('owner.someone');
    $('owner-contact').textContent = contact;
    $('owner-contact-line').hidden = !contact;
}

// ---------- device question (asked once) ----------

let choice = null;
function askDevice() {
    choice = null;
    $('device-text').textContent = '';
    $('device-continue').disabled = true;
    for (const b of [$('device-yes'), $('device-no')]) b.classList.add('quiet');
    screens('owner', 'device');
}
function pick(owned) {
    choice = owned ? 'owned' : 'guest';
    $('device-yes').classList.toggle('quiet', !owned);
    $('device-no').classList.toggle('quiet', owned);
    $('device-text').textContent = t(owned ? 'device.textPersonal' : 'device.textGuest');
    $('device-continue').disabled = false;
}
$('device-yes').onclick = () => pick(true);
$('device-no').onclick = () => pick(false);
$('device-continue').onclick = async () => {
    await L.setMode(choice);
    $('mode').value = choice;
    next();
};

// ---------- password ----------

$('unlock').onclick = async () => {
    $('lock-msg').textContent = '';
    try {
        pwKey = await F.unlock(header, p.id, $('pw').value);
    } catch {
        $('lock-msg').textContent = t('lock.wrong');
        return;
    }
    $('pw').value = '';
    next();
};

// ---------- tracks ----------

const fmt = d => d.toLocaleDateString(language(), { day: 'numeric', month: 'long' });

function renderTracks() {
    $('tracks').replaceChildren(...header.tracks.map(tr => {
        const w = F.windowStatus(tr.window);
        const row = document.createElement('div');
        row.className = 'track';
        row.innerHTML = '<div><div class="title"></div><div class="muted"></div></div>';
        row.querySelector('.title').textContent = tr.title;
        const note = row.querySelector('.muted');
        if (w.state === 'open') {
            note.textContent = w.closes ? t('dateLock.availableUntil', { date: fmt(w.closes) }) : '';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = t('player.play');
            btn.onclick = () => play(tr, btn);
            row.append(btn);
        } else {
            note.textContent = w.state === 'locked' ? t('dateLock.availableOn', { date: fmt(w.opens) }) : t('dateLock.expired');
        }
        return row;
    }));
    if (!header.tracks.length) $('tracks').innerHTML = `<p class="muted">${t('player.empty')}</p>`;
}

async function play(tr, btn) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '…';
    try {
        const path = `${p.id}/${tr.f}`;
        let sealed = L.isOwned() ? await L.getFile(path) : null;
        sealed ??= await R2.get(config.publicBase, path);
        const audio = await F.openTrack(sealed, p.id, tr.f, await F.trackKey(tr, p.id, pwKey));
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = URL.createObjectURL(new Blob([audio], { type: tr.type }));
        $('audio').src = currentUrl;
        $('audio').hidden = false;
        await $('audio').play();
    } catch {
        status(t('player.couldNotPlay', { title: tr.title }));
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
}

// ---------- owned device: keep everything for offline ----------

async function keep() {
    const id = p.id;
    await L.putPebbble({ id, key: p.key, pwKey, header: sealedHeader, title: header.name, cover: F.coverSeed(header, id), name: header.owner.name, count: header.tracks.length, savedAt: Date.now() });

    // All tracks, including ones not open yet, so a Christmas message still opens offline.
    const wanted = header.tracks.map(tr => `${id}/${tr.f}`);
    const note = $('saved-note');
    note.hidden = false;
    let done = 0;
    for (const path of wanted) {
        if (!(await L.getFile(path))) {
            note.textContent = t('library.saving', { done, total: wanted.length });
            try { await L.putFile(path, await R2.get(config.publicBase, path)); } catch { note.hidden = true; return; }
        }
        done++;
    }
    for (const path of await L.filePaths(id)) if (!wanted.includes(path)) await L.deleteFile(path);
    if (p?.id === id) note.textContent = t('library.saved');
}

// ---------- settings ----------

$('lang').replaceChildren(...Object.entries(LANGUAGES).map(([code, name]) => new Option(name, code)));
$('lang').onchange = async () => {
    await setLanguage($('lang').value);
    if (header && !$('list').hidden) renderTracks();
    else if (!$('library').hidden) home();
    if (!$('device').hidden && choice) pick(choice === 'owned');
};

$('mode').onchange = async () => {
    const mode = $('mode').value;
    if (mode === 'guest' && L.isOwned() && !confirm(t('settings.clearConfirm'))) { $('mode').value = 'owned'; return; }
    await L.setMode(mode);
    $('saved-note').hidden = true;
    if (mode === 'owned' && header && !$('list').hidden) keep();
    if (!header) home();
};

$('clear').onclick = async () => {
    if (!confirm(t('settings.clearConfirm'))) return;
    await L.clearAll();
    $('settings-msg').textContent = t('settings.dataCleared');
    $('saved-note').hidden = true;
    if (!header) home();
};

// ---------- start ----------

// A new tap while the page is open changes only the hash.
window.addEventListener('hashchange', () => { const f = takeFragment(); if (f) load(f); });

navigator.serviceWorker?.register('sw.js').catch(() => {});

await initI18n();
$('lang').value = language();
$('mode').value = L.getMode() || '';

const first = takeFragment();
if (first) load(first);
else home();
