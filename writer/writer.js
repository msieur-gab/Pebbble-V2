// Pebbble writer: make and edit pebbbles, write them to stones.
//
// First time on a device: connect storage (guided, or a setup code from another
// device), then choose the key phrase that opens "My pebbbles" everywhere.
// Then: my pebbbles → the editor (name, From / For, voices, password, if found)
// → save → hold the stone to the phone. Writing tags needs Chrome on Android;
// elsewhere a pebbble is saved and written later from the phone.
import * as F from '../shared/format.js';
import * as R2 from '../shared/r2.js';
import { config } from '../shared/config.js';
import { initI18n, setLanguage, language, LANGUAGES, t } from '../shared/i18n.js';
import { $, esc, mmss, stone, plural, ICON, dedication, belongsTo, createSheets, toast, shake } from '../shared/ui.js';

const VERSION = '2026-09-29 · 10:40'; // shown in Settings
const SETTINGS_KEY = 'pebbble-writer-settings';
const LIB_CACHE = 'pebbble-writer-library'; // also read by the player to offer Edit
const canNfc = 'NDEFReader' in window;

let view = 'none';
const sheets = createSheets({ onOpen: id => { if (id === 'settings-sheet') renderSettings(); }, onClose: stopRecording });

// ---------- settings on this device ----------
// { accountId, accessKeyId, secretAccessKey, bucket, publicBase, libId, libKey, setupKey }
// The key phrase itself is never kept: only keys derived from it.

function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
const STORAGE_FIELDS = ['accountId', 'accessKeyId', 'secretAccessKey', 'bucket', 'publicBase'];
const hasStorage = () => STORAGE_FIELDS.every(k => loadSettings()[k]);
const hasKeys = () => !!(loadSettings().libId && loadSettings().setupKey); // devices set up before setup codes ask for the key phrase once

function creds(s = loadSettings()) {
    if (config.devEndpoint) return { accountId: 'dev', accessKeyId: 'dev', secretAccessKey: 'dev', bucket: 'dev', endpoint: config.devEndpoint };
    return s;
}
const publicBase = (s = loadSettings()) => (config.devEndpoint ? config.publicBase : s.publicBase);

// ---------- my pebbbles (library) ----------
// One encrypted file in the bucket, plus a copy on this device so the list shows at
// once and the player can recognise this creator's pebbbles.

let library = F.newLibrary();
const libCreds = () => { const s = loadSettings(); return s.libId ? { libId: s.libId, libKey: s.libKey } : null; };
const cacheLibrary = () => { try { localStorage.setItem(LIB_CACHE, JSON.stringify(library)); } catch {} };
const cachedLibrary = () => { try { return JSON.parse(localStorage.getItem(LIB_CACHE)) || F.newLibrary(); } catch { return F.newLibrary(); } };

async function fetchLibrary(lc = libCreds()) {
    const sealed = await R2.get(publicBase(), `_library/${lc.libId}`, { fresh: true });
    return sealed ? F.openLibrary(sealed, lc) : F.newLibrary();
}

/** Read–modify–write, so two devices saving at once don't erase each other's pebbbles. */
async function changeLibrary(change) {
    const lc = libCreds();
    library = change(await fetchLibrary(lc));
    await R2.put(creds(), `_library/${lc.libId}`, await F.sealLibrary(library, lc), { cacheControl: 'no-cache' });
    cacheLibrary();
}

const libraryEntry = (p, header) => ({ id: p.id, key: p.key, name: header.name, cover: F.coverSeed(header, p.id), for: header.for, count: header.tracks.length, updated: Date.now() });
const remember = (p, header) => changeLibrary(lib => F.upsertLibrary(lib, libraryEntry(p, header)));

// ---------- views ----------

function draw(html, dock = null) {
    $('app').innerHTML = html;
    window.scrollTo(0, 0);
    $('dock').hidden = !dock;
    if (dock) { $('dock-btn').textContent = dock.label; $('dock-btn').onclick = dock.onclick; $('dock-btn').disabled = false; }
}

function showStatus(text) {
    view = 'status';
    draw(`<p class="status">${esc(text)}</p>`);
}

function renderWelcome() {
    view = 'welcome';
    draw(`<section class="welcome">
        <div class="stone breathing appear">${stone('pebbble-1')}</div>
        <p class="eyebrow appear d1">${t('writer.welcome.eyebrow')}</p>
        <h1 class="serif appear d1">${t('writer.welcome.title')}</h1>
        <p class="lead appear d2">${t('writer.welcome.lead')}</p>
        <div class="appear d3">
            <button class="choice" id="c-paste"><b>${t('writer.welcome.paste')}</b><span>${t('writer.welcome.pasteText')}</span></button>
            <button class="choice" id="c-guide"><b>${t('writer.welcome.guide')}</b><span>${t('writer.welcome.guideText')}</span></button>
        </div>
    </section>`);
    $('c-paste').onclick = () => { $('paste-msg').textContent = ''; sheets.open('paste-sheet'); };
    $('c-guide').onclick = openGuide;
}

/** Key phrase. After a setup code, the phrase must open that code; otherwise it's a new phrase. */
let pendingCode = null;
function renderKey() {
    view = 'key';
    const joining = !!pendingCode;
    draw(`<section class="welcome">
        <div class="stone appear">${stone('pebbble-1')}</div>
        <p class="eyebrow appear d1">${t('writer.key.eyebrow')}</p>
        <h1 class="serif appear d1">${t(joining ? 'writer.key.titleJoin' : 'writer.key.title')}</h1>
        <p class="lead appear d2">${t(joining ? 'writer.key.leadJoin' : 'writer.key.lead')}</p>
        <form class="appear d3" autocomplete="off" onsubmit="return false">
            <input class="field" id="k-in" type="password" autocomplete="new-password" data-lpignore="true" placeholder="${esc(t('writer.key.placeholder'))}">
            ${joining ? '' : `<p class="note">${t('writer.key.lose')}</p>`}
            <button type="button" class="primary" id="k-go">${t('writer.key.go')}</button>
            <p class="msg" id="k-msg"></p>
        </form>
    </section>`);
    $('k-go').onclick = async () => {
        const phrase = $('k-in').value.trim();
        if (phrase.split(/\s+/).length < 3) { $('k-msg').textContent = t('writer.key.short'); return; }
        $('k-go').disabled = true;
        $('k-go').textContent = t('writer.key.opening');
        try {
            const setupKey = await F.deriveSetupKey(phrase);
            let s = loadSettings();
            if (joining) {
                try { s = { ...s, ...(await F.openSetup(pendingCode, setupKey)) }; }
                catch { $('k-msg').textContent = t('writer.key.wrong'); shake($('k-in')); return; }
            }
            Object.assign(s, { setupKey }, await F.deriveLibrary(phrase, config.devEndpoint ? 'dev' : s.bucket));
            saveSettings(s);
            pendingCode = null;
            try { localStorage.removeItem(LIB_CACHE); } catch {}
            await home();
        } finally {
            if ($('k-go')) { $('k-go').disabled = false; $('k-go').textContent = t('writer.key.go'); }
        }
    };
}

function renderLibrary() {
    view = 'library';
    const items = library.items;
    draw(`<div class="bar"><span style="width:44px"></span><span class="title">${t('writer.title')}</span><button class="icon-btn" id="gear" aria-label="${esc(t('settings.title'))}">${ICON.settings}</button></div>
        <section class="library"><h1 class="serif">${t('library.title')}</h1>
        <div class="shelf" id="shelf">
            ${items.map(it => `<button data-id="${esc(it.id)}"><div class="stone">${stone(it.cover || it.id, 'thumb')}</div>
                <div class="name">${esc(it.name || t('writer.untitled'))}</div>
                <div class="sub">${esc(it.for ? t('pebbble.for', { for: it.for }) : plural('library.count', it.count))}</div></button>`).join('')}
            <button class="new" id="new"><i>+</i><div class="name">${t('writer.library.new')}</div></button>
        </div>
        <button class="tap-hint" id="tap-hint"><span class="mini-rings"><i></i><i></i><b></b></span><span id="tap-text">${t(canNfc ? 'writer.library.tap' : 'writer.library.noNfc')}</span></button>
        <button class="link paste-link" id="paste-link">${t('writer.library.pasteLink')}</button>
        </section>`);
    $('gear').onclick = () => sheets.open('settings-sheet');
    $('new').onclick = newPebbble;
    for (const b of $('shelf').querySelectorAll('button[data-id]')) {
        const it = items.find(i => i.id === b.dataset.id);
        b.onclick = () => openPebbble({ id: it.id, key: it.key });
    }
    $('tap-hint').onclick = () => (canNfc ? scanStone() : openLinkSheet());
    $('paste-link').onclick = openLinkSheet;
}

async function home() {
    stopScan();
    if (!hasStorage()) return renderWelcome();
    if (!hasKeys()) return renderKey();
    library = cachedLibrary();
    renderLibrary();
    try { library = await fetchLibrary(); cacheLibrary(); if (view === 'library') renderLibrary(); } catch {}
}

// ---------- setup: guided ----------

const CORS = JSON.stringify([{ AllowedOrigins: [location.origin], AllowedMethods: ['GET', 'PUT', 'DELETE'], AllowedHeaders: ['*'], MaxAgeSeconds: 86400 }], null, 2);

function openGuide() {
    const s = loadSettings();
    $('g-bucket').value = s.bucket || 'pebbble';
    $('g-public').value = s.publicBase || '';
    $('g-endpoint').value = s.accountId ? `https://${s.accountId}.r2.cloudflarestorage.com` : '';
    $('g-key').value = s.accessKeyId || '';
    $('g-secret').value = s.secretAccessKey || '';
    $('g-cors').textContent = CORS;
    $('g-msg').textContent = '';
    markSteps();
    sheets.open('guide-sheet');
}
function markSteps() {
    $('step-1').classList.toggle('done', !!$('g-bucket').value.trim());
    $('step-2').classList.toggle('done', /^https:\/\/\S+/.test($('g-public').value.trim()));
    $('step-3').classList.toggle('done', !!(accountFrom($('g-endpoint').value) && $('g-key').value.trim() && $('g-secret').value.trim()));
}
for (const id of ['g-bucket', 'g-public', 'g-endpoint', 'g-key', 'g-secret']) $(id).oninput = markSteps;
/** The account ID, from the S3 address Cloudflare shows or typed on its own. */
function accountFrom(text) {
    const v = text.trim();
    return /^https:\/\/([a-z0-9]+)\.r2\.cloudflarestorage\.com/i.exec(v)?.[1] || (/^[a-z0-9]{16,}$/i.test(v) ? v : '');
}
$('g-cors-copy').onclick = () => copy(CORS);

$('g-connect').onclick = async () => {
    markSteps();
    const s = {
        ...loadSettings(),
        bucket: $('g-bucket').value.trim(),
        publicBase: $('g-public').value.trim().replace(/\/$/, ''),
        accountId: accountFrom($('g-endpoint').value),
        accessKeyId: $('g-key').value.trim(),
        secretAccessKey: $('g-secret').value.trim(),
    };
    const missing = STORAGE_FIELDS.find(k => !s[k]);
    if (missing) { $('g-msg').textContent = t('writer.guide.missing'); return; }
    $('g-connect').disabled = true;
    $('g-msg').textContent = '';
    $('g-connect').textContent = t('writer.guide.checking');
    try {
        const probe = F.randomBytes(8);
        try { await R2.put(creds(s), '_check', probe, { cacheControl: 'no-cache' }); }
        catch { $('g-msg').textContent = t('writer.guide.badKey'); return; }
        let back = null;
        try { back = await R2.get(publicBase(s), '_check', { fresh: true }); } catch {}
        if (!back || back.join() !== probe.join()) { $('g-msg').textContent = t('writer.guide.badPublic'); return; }
        const changed = loadSettings().bucket && loadSettings().bucket !== s.bucket;
        if (changed) { delete s.libId; delete s.libKey; } // another bucket holds another list
        saveSettings(s);
        sheets.closeAll();
        toast(t('writer.guide.connected'));
        await home();
    } finally {
        $('g-connect').disabled = false;
        $('g-connect').textContent = t('writer.guide.connect');
    }
};

// ---------- setup: code from another device ----------

$('paste-go').onclick = () => {
    const code = $('paste-code').value.trim();
    if (!F.isSetupCode(code)) { $('paste-msg').textContent = t('writer.paste.bad'); return; }
    pendingCode = code;
    sheets.closeAll();
    renderKey();
};

function openShare() {
    const s = loadSettings();
    $('share-code').textContent = '…';
    sheets.open('share-sheet');
    F.sealSetup(Object.fromEntries(STORAGE_FIELDS.map(k => [k, s[k]])), s.setupKey).then(code => { $('share-code').textContent = code; });
}
$('share-copy').onclick = () => copy($('share-code').textContent);

// ---------- opening a pebbble ----------

let scanAbort = null;
function stopScan() { scanAbort?.abort(); scanAbort = null; }

async function scanStone() {
    if (scanAbort) return;
    scanAbort = new AbortController();
    $('tap-hint').classList.add('listening');
    $('tap-text').textContent = t('writer.library.listening');
    try {
        const reader = new NDEFReader();
        reader.onreading = e => {
            const rec = [...e.message.records].find(r => r.recordType === 'url');
            let p = null;
            try { p = rec && F.parseFragment(new URL(new TextDecoder().decode(rec.data)).hash); } catch {}
            if (!p) { toast(t('writer.library.notPebbble')); return; }
            stopScan();
            openPebbble(p);
        };
        await reader.scan({ signal: scanAbort.signal });
    } catch {
        stopScan();
        toast(t('writer.library.cannotScan'));
        if (view === 'library') renderLibrary();
    }
}

function openLinkSheet() {
    $('link-in').value = '';
    $('link-msg').textContent = '';
    sheets.open('link-sheet');
}
$('link-go').onclick = () => {
    let p = null;
    try { p = F.parseFragment(new URL($('link-in').value.trim()).hash); } catch {}
    if (!p) { $('link-msg').textContent = t('writer.link.bad'); return; }
    sheets.closeAll();
    openPebbble(p);
};

// ---------- editor state ----------
// s = { p, header, pwKey, pending: [{title, blob, type, window, duration}], removed: [file],
//       pwPlan: null | {password, hint} | {hint} | 'remove', isNew }
let s = null;

function newPebbble() {
    s = { p: F.newPebbble(), header: F.newHeader({ from: lastFrom() }), pwKey: null, pending: [], removed: [], pwPlan: null, isNew: true };
    s.header.contact = lastContact();
    renderEditor();
}
// A new pebbble starts with the From and contact of the last one saved on this device.
const lastFrom = () => { try { return localStorage.getItem('pebbble-writer-from') || ''; } catch { return ''; } };
const lastContact = () => { try { return localStorage.getItem('pebbble-writer-contact') || ''; } catch { return ''; } };

async function openPebbble(p) {
    showStatus(t('writer.opening'));
    try {
        const sealed = await R2.get(publicBase(), `${p.id}/header`, { fresh: true });
        if (!sealed) throw new Error(t('writer.notFound'));
        const header = await F.openHeader(sealed, p);
        s = { p, header, pwKey: null, pending: [], removed: [], pwPlan: null, isNew: false };
        remember(p, header).catch(() => {}); // opening a stone adds it to the list
        if (header.pw) renderUnlock();
        else renderEditor();
    } catch (e) {
        await home();
        toast(e.message === 'decrypt-failed' ? t('writer.wrongLink') : e.message.startsWith('fetch-failed') ? t('writer.offline') : e.message);
    }
}

function renderUnlock() {
    view = 'unlock';
    const { header } = s;
    draw(`<div class="bar"><button class="icon-btn" id="back" aria-label="${esc(t('library.title'))}">${ICON.back}</button><span class="title">${t('writer.edit')}</span><span style="width:44px"></span></div>
        <section class="welcome center" style="min-height:auto;padding-top:24px">
            <div class="stone">${stone(F.coverSeed(header, s.p.id))}</div>
            <h1 class="serif" style="font-size:1.8rem;margin:0 0 6px">${esc(header.name || t('writer.untitled'))}</h1>
            <p class="lead" style="margin:0 0 20px">${t(header.hint ? 'writer.unlock.lead' : 'writer.unlock.leadNoHint')}</p>
            ${header.hint ? `<p class="hint">“${esc(header.hint)}”</p>` : ''}
            <form autocomplete="off" onsubmit="return false">
                <input class="field" id="u-pw" type="password" autocomplete="off" data-lpignore="true" placeholder="${esc(t('lock.password'))}">
                <button type="submit" class="primary" id="u-go">${t('writer.unlock.go')}</button>
                <p class="msg" id="u-msg"></p>
            </form>
        </section>`);
    $('back').onclick = home;
    $('u-go').onclick = async () => {
        try {
            s.pwKey = await F.unlock(s.header, s.p.id, $('u-pw').value);
            renderEditor();
        } catch {
            $('u-msg').textContent = t('lock.wrong');
            shake($('u-pw'));
        }
    };
    setTimeout(() => $('u-pw')?.focus(), 300);
}

// ---------- the editor ----------

const rows = () => [
    ...s.header.tracks.map((tr, i) => ({ kind: 'track', i, title: tr.title, window: tr.window, duration: tr.duration })),
    ...s.pending.map((pd, i) => ({ kind: 'pending', i, title: pd.title, window: pd.window, duration: pd.duration, fresh: true })),
];

/** What the password row says, taking unsaved changes into account. */
function pwState() {
    if (s.pwPlan === 'remove') return { on: false };
    if (s.pwPlan?.password) return { on: true, hint: s.pwPlan.hint };
    if (s.header.pw) return { on: true, hint: s.pwPlan?.hint ?? s.header.hint };
    return { on: false };
}

function renderEditor() {
    view = 'editor';
    const { header, p } = s;
    const pw = pwState();
    const list = rows();
    draw(`<div class="bar"><button class="icon-btn" id="back" aria-label="${esc(t('library.title'))}">${ICON.back}</button><span class="title">${t(s.isNew ? 'writer.library.new' : 'writer.edit')}</span><span style="width:44px"></span></div>
        <form autocomplete="off" onsubmit="return false">
            <div class="ed-head">
                <div class="stone" id="e-stone">${stone(F.coverSeed(header, p.id))}</div>
                <button type="button" class="reroll" id="reroll">${ICON.reroll}${t('writer.editor.anotherStone')}</button>
                <input class="name-in" id="e-name" name="pebbble-title" value="${esc(header.name)}" placeholder="${esc(t('writer.editor.namePlaceholder'))}" aria-label="${esc(t('writer.editor.name'))}" autocomplete="off" data-lpignore="true">
            </div>
            <div class="dedic">
                <label><span>${t('writer.editor.from')}</span><input id="e-from" name="pebbble-from" value="${esc(header.from)}" placeholder="${esc(t('writer.editor.fromPlaceholder'))}" autocomplete="off" data-lpignore="true"></label>
                <label><span>${t('writer.editor.for')}</span><input id="e-for" name="pebbble-for" value="${esc(header.for)}" placeholder="${esc(t('writer.editor.optional'))}" autocomplete="off" data-lpignore="true"></label>
            </div>
        </form>
        <div class="preview" id="preview"></div>

        <div class="section">
            <div class="section-head"><h2>${t('writer.editor.voices')}</h2><span>${list.length ? plural('library.count', list.length) : ''}</span></div>
            <ul class="voices" id="e-voices">${list.map((r, n) => `<li class="voice ${r.window ? 'sleeping' : ''} " data-kind="${r.kind}" data-i="${r.i}">
                <span class="n">${r.window ? ICON.moon : n + 1}</span>
                <span class="t">${esc(r.title)}${r.fresh ? `<i class="badge">${t('writer.editor.new')}</i>` : ''}${r.window ? `<span class="wake">${esc(windowLabel(r.window))}</span>` : ''}</span>
                <span class="d">${mmss(r.duration)}</span></li>`).join('')}</ul>
            <button class="add-voice" id="add-voice"><i>+</i>${t('writer.editor.addVoice')}</button>
        </div>

        <div class="section">
            <div class="section-head"><h2>${t('writer.editor.safe')}</h2></div>
            <div>
                <button class="menu-row" id="r-pw"><span class="txt"><b>${t('writer.pw.title')}</b><span>${esc(pw.on ? (pw.hint ? t('writer.editor.pwHint', { hint: pw.hint }) : t('writer.editor.pwOn')) : t('writer.editor.pwOff'))}</span></span>${ICON.chev}</button>
                <button class="menu-row" id="r-found"><span class="txt"><b>${t('writer.found.title')}</b><span>${esc(header.contact || t('writer.editor.addContact'))}</span></span>${ICON.chev}</button>
            </div>
        </div>
        ${s.isNew ? '' : `<div class="section"><div>
            ${canNfc ? `<button class="menu-row" id="r-write"><span class="txt"><b>${t('writer.editor.writeAgain')}</b><span>${t('writer.editor.writeAgainText')}</span></span>${ICON.chev}</button>` : ''}
            <button class="menu-row warn" id="r-delete"><span class="txt"><b>${t('writer.editor.delete')}</b><span>${t('writer.editor.deleteText')}</span></span></button>
        </div></div>`}`,
        { label: t(s.isNew ? (canNfc ? 'writer.save.andWrite' : 'writer.save.save') : 'writer.save.changes'), onclick: save });
    renderPreview();
    $('back').onclick = home;
    // The stone is drawn from a seed kept in the header: changing it rewrites the header only.
    $('reroll').onclick = () => { header.cover = F.newCoverSeed(); $('e-stone').innerHTML = stone(header.cover); renderPreview(); };
    $('e-name').oninput = e => { header.name = e.target.value; renderPreview(); };
    $('e-from').oninput = e => { header.from = e.target.value; renderPreview(); };
    $('e-for').oninput = e => { header.for = e.target.value; renderPreview(); };
    $('add-voice').onclick = () => openVoice(null);
    for (const li of $('e-voices').querySelectorAll('.voice')) li.onclick = () => openVoice({ kind: li.dataset.kind, i: +li.dataset.i });
    $('r-pw').onclick = openPassword;
    $('r-found').onclick = openFound;
    if ($('r-write')) $('r-write').onclick = () => renderWrite();
    if ($('r-delete')) $('r-delete').onclick = deletePebbble;
}

function renderPreview() {
    const { header, p } = s;
    const d = dedication(header), n = rows().length;
    $('preview').innerHTML = `<span class="cap">${t('writer.editor.preview')}</span>
        <div class="stone">${stone(F.coverSeed(header, p.id), 'thumb')}</div>
        <div style="min-width:0">
            <div class="pv-name">${esc(header.name || t('writer.editor.namePlaceholder'))}</div>
            ${d ? `<div class="pv-ded">${esc(d)}</div>` : ''}
            <div class="pv-count">${n ? plural('arrival.voices', n) : t('writer.editor.noVoices')}</div>
        </div>
        <span class="seg" role="group" aria-label="${esc(t('writer.editor.style'))}">
            <button type="button" data-ded="" class="${header.ded ? '' : 'on'}">${t('writer.editor.styleTag')}</button>
            <button type="button" data-ded="love" class="${header.ded === 'love' ? 'on' : ''}">${t('writer.editor.styleLove')}</button>
        </span>`;
    for (const b of $('preview').querySelectorAll('.seg button')) b.onclick = () => {
        if (b.dataset.ded) header.ded = b.dataset.ded; else delete header.ded;
        renderPreview();
    };
}

// ---------- dates ----------

const monthName = m => new Date(2000, m - 1, 1).toLocaleDateString(language(), { month: 'long' });
const dayMonth = mmdd => { const [m, d] = mmdd.split('-').map(Number); return new Date(2000, m - 1, d).toLocaleDateString(language(), { day: 'numeric', month: 'long' }); };
const fullDate = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(language(), { day: 'numeric', month: 'long', year: 'numeric' }); };

function windowLabel(w) {
    if (w.from) return t('writer.voice.wakesOn', { date: fullDate(w.from) });
    const [a, b] = w.every.split('..');
    return a === b ? t('writer.voice.everyYearOn', { date: dayMonth(a) }) : t('writer.voice.everyYear', { from: dayMonth(a), to: dayMonth(b) });
}

function fillDayMonth(dayId, monthId, mmdd) {
    const [m, d] = mmdd.split('-').map(Number);
    $(dayId).innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${i + 1 === d ? 'selected' : ''}>${i + 1}</option>`).join('');
    $(monthId).innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${esc(monthName(i + 1))}</option>`).join('');
}
const pad = n => String(n).padStart(2, '0');
const readDayMonth = (dayId, monthId) => `${pad($(monthId).value)}-${pad($(dayId).value)}`;

// ---------- the voice sheet ----------

let editing = null; // null = a new voice, else { kind, i }
let recorded = null; // { blob, type, duration } for a new voice
let when = 'always';

function setWhen(w) {
    when = w;
    for (const b of $('v-when').children) b.classList.toggle('on', b.dataset.w === w);
    $('v-from-box').hidden = w !== 'from';
    $('v-yearly-box').hidden = w !== 'yearly';
    $('v-when-note').textContent = t({ always: 'writer.voice.alwaysNote', from: 'writer.voice.fromNote', yearly: 'writer.voice.yearlyNote' }[w]);
}
for (const b of $('v-when').children) b.onclick = () => setWhen(b.dataset.w);

function openVoice(ref) {
    editing = ref;
    recorded = null;
    const r = ref && rows().find(x => x.kind === ref.kind && x.i === ref.i);
    $('v-head').textContent = t(r ? 'writer.voice.thisVoice' : 'writer.voice.newVoice');
    $('v-rec').hidden = !!r;
    $('v-listen-row').hidden = !r;
    $('v-play-time').textContent = r ? mmss(r.duration) : '';
    showRecorded();
    $('v-title').value = r ? r.title : '';
    $('v-save').textContent = t(r ? 'writer.voice.keep' : 'writer.voice.add');
    $('v-remove').hidden = !r;
    resetRemove();
    $('v-msg').textContent = '';
    const w = r?.window;
    const today = new Date();
    $('v-from').value = w?.from || `${today.getFullYear() + 1}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const [ya, yb] = w?.every ? w.every.split('..') : ['12-24', '12-26'];
    fillDayMonth('v-ya-d', 'v-ya-m', ya);
    fillDayMonth('v-yb-d', 'v-yb-m', yb);
    setWhen(w?.from ? 'from' : w?.every ? 'yearly' : 'always');
    sheets.open('voice-sheet');
}

function chosenWindow() {
    if (when === 'from') return $('v-from').value ? { from: $('v-from').value } : undefined;
    if (when === 'yearly') return { every: `${readDayMonth('v-ya-d', 'v-ya-m')}..${readDayMonth('v-yb-d', 'v-yb-m')}` };
    return undefined;
}

$('v-save').onclick = () => {
    const title = $('v-title').value.trim();
    if (!editing && !recorded) { $('v-msg').textContent = t('writer.voice.needAudio'); return; }
    if (!title) { $('v-msg').textContent = t('writer.voice.needTitle'); shake($('v-title')); return; }
    const window = chosenWindow();
    if (!editing) {
        s.pending.push({ title, window, ...recorded });
    } else {
        const target = editing.kind === 'track' ? s.header.tracks[editing.i] : s.pending[editing.i];
        target.title = title;
        if (window) target.window = window; else delete target.window;
    }
    sheets.closeAll();
    renderEditor();
};

// Removing asks twice, like Forget in the player.
function resetRemove() { $('v-remove').textContent = t('writer.voice.remove'); $('v-remove').dataset.confirm = ''; }
$('v-remove').onclick = () => {
    if (!$('v-remove').dataset.confirm) { $('v-remove').dataset.confirm = '1'; $('v-remove').textContent = t('writer.voice.removeConfirm'); return; }
    if (editing.kind === 'track') {
        s.removed.push(s.header.tracks[editing.i].f);
        s.header.tracks.splice(editing.i, 1);
    } else {
        s.pending.splice(editing.i, 1);
    }
    sheets.closeAll();
    renderEditor();
};

// ---------- listening before keeping ----------
// A new recording plays from memory; a saved voice is fetched and decrypted, like the player does.

let previewAudio = null, previewUrl = null;

function stopPreview() {
    previewAudio?.pause();
    previewAudio = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    for (const b of document.querySelectorAll('[data-listen]')) b.textContent = t('writer.voice.listen');
}

async function togglePreview(button, getBlob) {
    if (previewAudio) { stopPreview(); return; }
    button.textContent = t('writer.voice.opening');
    try {
        previewUrl = URL.createObjectURL(await getBlob());
        previewAudio = new Audio(previewUrl);
        previewAudio.onended = stopPreview;
        await previewAudio.play();
        button.textContent = t('writer.voice.stop');
    } catch {
        stopPreview();
        $('v-msg').textContent = t('writer.voice.cannotPlay');
    }
}

/** The audio of a voice in the list: pending ones are in memory, saved ones are in storage. */
async function voiceBlob(ref) {
    if (ref.kind === 'pending') return s.pending[ref.i].blob;
    const tr = s.header.tracks[ref.i];
    const sealed = await R2.get(publicBase(), `${s.p.id}/${tr.f}`);
    const bytes = await F.openTrack(sealed, s.p.id, tr.f, await F.trackKey(tr, s.p.id, s.pwKey));
    return new Blob([bytes], { type: tr.type });
}
$('v-play').onclick = () => togglePreview($('v-play'), () => voiceBlob(editing));

// ---------- recording ----------

let recorder = null, recTimer = null, recStart = 0;

function showRecorded() {
    $('rec-btn').classList.remove('on');
    $('rec-time').textContent = recorded ? mmss(recorded.duration) : '0:00';
    $('rec-or').innerHTML = recorded
        ? `${esc(recorded.name || t('writer.voice.recorded'))} · <button type="button" class="link" id="v-listen" data-listen>${t('writer.voice.listen')}</button> · <button type="button" class="link" id="v-pick">${t('writer.voice.otherFile')}</button>`
        : `${t('writer.voice.or')} <button type="button" class="link" id="v-pick">${t('writer.voice.chooseFile')}</button>`;
    $('v-pick').onclick = () => $('v-file').click();
    if ($('v-listen')) $('v-listen').onclick = () => togglePreview($('v-listen'), async () => recorded.blob);
}

$('rec-btn').onclick = async () => {
    if (recorder) { recorder.stop(); return; }
    stopPreview();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { $('v-msg').textContent = t('writer.voice.noMic'); return; }
    const chunks = [];
    // Prefer AAC in MP4 (plays everywhere, including iPhone); fall back to the browser's default.
    const mimeType = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
        stream.getTracks().forEach(tr => tr.stop());
        clearInterval(recTimer);
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        recorder = null;
        if (!chunks.length) return showRecorded(); // closed while recording
        recorded = { blob, type, duration: (await audioDuration(blob)) || Math.round((Date.now() - recStart) / 1000) };
        showRecorded();
    };
    recorder.start();
    recStart = Date.now();
    $('rec-btn').classList.add('on');
    $('rec-or').textContent = t('writer.voice.tapToStop');
    recTimer = setInterval(() => { $('rec-time').textContent = mmss((Date.now() - recStart) / 1000); }, 250);
};

function stopRecording() {
    stopPreview();
    if (recorder) { recorder.ondataavailable = null; recorder.stop(); }
}

$('v-file').onchange = async () => {
    const file = $('v-file').files[0];
    $('v-file').value = '';
    if (!file) return;
    const duration = await audioDuration(file);
    if (!duration) { $('v-msg').textContent = t('writer.voice.badFile'); return; }
    recorded = { blob: file, type: file.type || 'audio/mpeg', duration, name: file.name };
    if (!$('v-title').value.trim()) $('v-title').value = file.name.replace(/\.[^.]+$/, '');
    $('v-msg').textContent = '';
    showRecorded();
};

/** Length of an audio file in seconds (0 if the browser can't read it). */
function audioDuration(blob) {
    return new Promise(resolve => {
        const a = new Audio();
        const url = URL.createObjectURL(blob);
        const done = d => { URL.revokeObjectURL(url); resolve(isFinite(d) ? Math.round(d) : 0); };
        a.onloadedmetadata = () => {
            if (isFinite(a.duration)) return done(a.duration);
            // Some recordings report Infinity until the end is found.
            a.ontimeupdate = () => { a.ontimeupdate = null; done(a.duration); };
            a.currentTime = 1e9;
        };
        a.onerror = () => done(0);
        a.src = url;
    });
}

// ---------- password and hint ----------
// The password only wraps the small per-voice keys in the header, so adding, changing
// or removing it rewrites the header alone: recordings and the stone stay as they are.

function openPassword() {
    const pw = pwState();
    $('pw-in').value = '';
    $('pw-hint').value = pw.on ? pw.hint || '' : '';
    $('pw-label').textContent = t(pw.on ? 'writer.pw.newPassword' : 'writer.pw.password');
    $('pw-in').placeholder = pw.on ? t('writer.pw.keepEmpty') : t('writer.pw.placeholder');
    $('pw-remove').hidden = !pw.on;
    $('pw-msg').textContent = '';
    sheets.open('pw-sheet');
}
$('pw-save').onclick = () => {
    const password = $('pw-in').value, hint = $('pw-hint').value.trim();
    if (password) s.pwPlan = { password, hint };
    else if (pwState().on) s.pwPlan = s.pwPlan?.password ? { ...s.pwPlan, hint } : { hint };
    else { $('pw-msg').textContent = t('writer.pw.empty'); shake($('pw-in')); return; }
    sheets.closeAll();
    renderEditor();
};
$('pw-remove').onclick = () => {
    s.pwPlan = s.header.pw ? 'remove' : null;
    sheets.closeAll();
    renderEditor();
};

// ---------- if someone finds it ----------

function renderFinder() {
    const who = belongsTo(s.header), contact = $('f-contact').value.trim();
    $('finder').innerHTML = contact
        ? `${who ? `${t('arrival.owner', { name: `<b>${esc(who)}</b>` })}<br>` : ''}${t('arrival.write', { contact: `<b>${esc(contact)}</b>` })}`
        : t('writer.found.nothing');
}
function openFound() {
    $('f-contact').value = s.header.contact || '';
    renderFinder();
    sheets.open('found-sheet');
}
$('f-contact').oninput = renderFinder;
$('f-done').onclick = () => {
    s.header.contact = $('f-contact').value.trim();
    sheets.closeAll();
    renderEditor();
};

// ---------- save: voices first, header last ----------

async function save() {
    const { p, header } = s;
    if (!rows().length) { toast(t('writer.save.needVoice')); return; }
    const btn = $('dock-btn');
    btn.disabled = true;
    try {
        const c = creds();
        for (const k of ['name', 'from', 'for', 'contact']) header[k] = (header[k] ?? '').trim();

        const plan = s.pwPlan;
        if (plan === 'remove') {
            await F.removePassword(header, p.id, s.pwKey);
            s.pwKey = null;
        } else if (plan?.password) {
            btn.textContent = t('writer.save.locking');
            s.pwKey = header.pw
                ? await F.changePassword(header, p.id, s.pwKey, plan.password, plan.hint)
                : await F.setPassword(header, p.id, plan.password, plan.hint);
        } else if (plan) {
            header.hint = plan.hint;
        }
        s.pwPlan = null;

        while (s.pending.length) {
            const pd = s.pending[0];
            btn.textContent = t('writer.save.uploading', { n: header.tracks.length + 1, total: header.tracks.length + s.pending.length });
            const file = F.newFileName();
            const { sealed, key } = await F.sealTrack(new Uint8Array(await pd.blob.arrayBuffer()), p.id, file);
            await R2.put(c, `${p.id}/${file}`, sealed, { cacheControl: 'public, max-age=31536000, immutable' });
            await F.addTrack(header, p.id, { file, title: pd.title, type: pd.type, window: pd.window, duration: pd.duration, key }, s.pwKey);
            s.pending.shift();
        }

        btn.textContent = t('writer.save.saving');
        await R2.put(c, `${p.id}/header`, await F.sealHeader(header, p), { cacheControl: 'no-cache' });
        for (const file of s.removed) await R2.del(c, `${p.id}/${file}`);
        s.removed = [];
        await remember(p, header);
        try { localStorage.setItem('pebbble-writer-from', header.from); localStorage.setItem('pebbble-writer-contact', header.contact); } catch {}

        const wasNew = s.isNew;
        s.isNew = false;
        if (wasNew && canNfc) return renderWrite();
        await home();
        toast(t(wasNew ? 'writer.save.savedWriteLater' : 'writer.save.saved'));
    } catch (e) {
        toast(e.message.startsWith('upload-failed') || e.message.startsWith('fetch-failed') ? t('writer.save.failed') : e.message);
        if (view === 'editor') renderEditor();
    }
}

async function deletePebbble() {
    const b = $('r-delete');
    if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.querySelector('b').textContent = t('writer.editor.deleteConfirm', { name: s.header.name || t('writer.untitled') });
        return;
    }
    const { p, header } = s;
    b.disabled = true;
    try {
        const c = creds();
        await R2.del(c, `${p.id}/header`);
        for (const tr of header.tracks) await R2.del(c, `${p.id}/${tr.f}`);
        await changeLibrary(lib => F.dropFromLibrary(lib, p.id));
        s = null;
        await home();
        toast(t('writer.editor.deleted', { name: header.name || t('writer.untitled') }));
    } catch {
        toast(t('writer.save.failed'));
        b.disabled = false;
    }
}

// ---------- writing the stone ----------

let writeAbort = null;
const tagLink = () => F.tagUrl(config.appBase, s.p);

async function renderWrite() {
    view = 'write';
    draw(`<div class="bar"><button class="icon-btn" id="cancel" aria-label="${esc(t('writer.write.cancel'))}">${ICON.back}</button><span class="title">${t('writer.write.bar')}</span><span style="width:44px"></span></div>
        <section class="write">
            <div class="rings"><i></i><i></i><i></i><div class="stone breathing">${stone(F.coverSeed(s.header, s.p.id), 'thumb')}</div></div>
            <h1 class="serif">${t('writer.write.title')}</h1>
            <p id="w-text">${t('writer.write.text')}</p>
        </section>`);
    $('cancel').onclick = () => { writeAbort?.abort(); renderEditor(); };
    writeAbort = new AbortController();
    try {
        await new NDEFReader().write({ records: [{ recordType: 'url', data: tagLink() }] }, { signal: writeAbort.signal });
        navigator.vibrate?.(60);
        renderWritten();
    } catch (e) {
        if (e.name === 'AbortError' || view !== 'write') return;
        $('w-text').innerHTML = `${esc(t('writer.write.failed'))}<br><button class="link" id="w-retry">${t('writer.write.retry')}</button>`;
        $('w-retry').onclick = renderWrite;
    }
}

function renderWritten(lock = 'idle') {
    view = 'written';
    const name = s.header.name || t('writer.untitled');
    const card = {
        idle: `<b>${t('writer.lock.title')}</b><span>${t('writer.lock.text')}</span><button class="link" id="lock-ask">${t('writer.lock.ask')}</button>`,
        confirm: `<b>${t('writer.lock.confirmTitle')}</b><span>${t('writer.lock.confirmText')}</span>
            <div class="two"><button class="ghost" id="lock-no">${t('writer.lock.no')}</button><button class="primary warn" id="lock-yes">${t('writer.lock.yes')}</button></div>`,
        holding: `<b>${t('writer.lock.confirmTitle')}</b><span>${t('writer.lock.hold')}</span>`,
        done: `<b>${t('writer.lock.done')}</b><span>${t('writer.lock.doneText')}</span>`,
    }[lock];
    draw(`<section class="write">
            <div class="check">${ICON.check}</div>
            <h1 class="serif">${t('writer.written.title', { name: esc(name) })}</h1>
            <p>${t('writer.written.text')}</p>
            <div class="actions">
                <button class="primary" id="w-listen">${t('writer.written.listen')}</button>
                <button class="ghost" id="w-copy">${t('writer.written.copy')}</button>
                <button class="ghost" id="w-done">${t('writer.written.back')}</button>
            </div>
            <div class="lock-card ${lock === 'idle' || lock === 'done' ? '' : 'confirm'}">${card}</div>
        </section>`);
    $('w-listen').onclick = () => { location.href = tagLink(); };
    $('w-copy').onclick = () => copy(tagLink());
    $('w-done').onclick = home;
    if ($('lock-ask')) $('lock-ask').onclick = () => renderWritten('confirm');
    if ($('lock-no')) $('lock-no').onclick = () => renderWritten('idle');
    if ($('lock-yes')) $('lock-yes').onclick = async () => {
        renderWritten('holding');
        try {
            await new NDEFReader().makeReadOnly();
            navigator.vibrate?.(60);
            renderWritten('done');
        } catch {
            toast(t('writer.lock.failed'));
            renderWritten('idle');
        }
    };
}

// ---------- settings ----------

function renderSettings() {
    const s = loadSettings();
    $('version').textContent = `Pebbble writer · ${VERSION}`;
    $('langs').innerHTML = Object.entries(LANGUAGES).map(([code, name]) => `<button data-lang="${code}" class="${code === language() ? 'on' : ''}">${name}</button>`).join('');
    for (const b of $('langs').querySelectorAll('button')) b.onclick = async () => {
        await setLanguage(b.dataset.lang);
        renderSettings();
        rerender();
    };
    $('s-storage').innerHTML = `<span class="txt"><b>${t('writer.settings.connected')}</b><span>${esc(t('writer.settings.bucket', { bucket: s.bucket || '' }))}</span></span>${ICON.chev}`;
    $('s-share').innerHTML = `<span class="txt"><b>${t('writer.settings.share')}</b><span>${t('writer.settings.shareText')}</span></span>${ICON.chev}`;
    $('s-share').hidden = !s.setupKey;
    $('s-disconnect').textContent = t('writer.settings.disconnect');
    $('s-disconnect').dataset.confirm = '';
}
$('s-storage').onclick = openGuide;
$('s-share').onclick = openShare;
$('s-disconnect').onclick = async () => {
    const b = $('s-disconnect');
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = t('writer.settings.disconnectConfirm'); return; }
    try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(LIB_CACHE); } catch {}
    library = F.newLibrary();
    sheets.closeAll();
    await home();
};

function rerender() {
    if (view === 'welcome') renderWelcome();
    else if (view === 'key') renderKey();
    else if (view === 'library') renderLibrary();
    else if (view === 'editor') renderEditor();
    else if (view === 'unlock') renderUnlock();
    else if (view === 'written') renderWritten();
}

// ---------- small helpers ----------

async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast(t('writer.copied')); }
    catch { toast(t('writer.copyFailed')); }
}

// ---------- start ----------

await initI18n();
// Opened from the player's Edit: writer/#<id>.<key>
const fromPlayer = F.parseFragment(location.hash);
if (fromPlayer) history.replaceState(null, '', location.pathname);
if (fromPlayer && hasStorage() && hasKeys()) {
    library = cachedLibrary();
    openPebbble(fromPlayer);
} else {
    home();
}
